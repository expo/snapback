import Foundation

// @ref LLP 0095#21-artifact-and-format — rule 4: a virtual clock starting at
//   0; frame/request/event steps are instantaneous, an advance step advances
//   by exactly its advanceVirtualTimeMs, timer actions may repeat within the
//   interval, and expect.pacing bounds consecutive-emission spacing.
/// Deterministic transport supervision on a virtual clock: the T-HB
/// heartbeat/freshness loop and the T-LOSS reconnect backoff of LLP 0095
/// §1.4 (constants from LLP 0034 D0/D1). The `clock: "virtual"` conformance
/// fixtures drive this component; it owns exactly the timing policy the
/// abstract model pins — 5 s heartbeat ping, 15 s freshness budget,
/// 250 ms → 10 s bounded reconnect backoff — and forces the loss and lease
/// transitions on the machine when their deadlines pass.
final class VirtualTransportSupervisor {
    public static let heartbeatIntervalMs: UInt64 = 5000
    public static let freshnessBudgetMs: UInt64 = 15000
    public static let reconnectBackoffFloorMs: UInt64 = 250
    public static let reconnectBackoffCapMs: UInt64 = 10000

    /// One timer-driven action emission with its virtual timestamp; the
    /// rule-4 pacing judgment is over these timestamps.
    public struct TimedAction: Sendable {
        public var atMs: UInt64
        public var action: ClientAction
    }

    private let machine: ClientStateMachine
    public private(set) var nowMs: UInt64 = 0
    private var lastServerActivityMs: UInt64?
    private var lastPingMs: UInt64?
    private var nextReconnectAtMs: UInt64?
    private var reconnectDelayMs: UInt64 = VirtualTransportSupervisor.reconnectBackoffFloorMs

    public init(
        machine: ClientStateMachine,
        lastServerActivityMs: UInt64? = nil,
        socketLostAtMs: UInt64? = nil
    ) {
        self.machine = machine
        self.lastServerActivityMs = lastServerActivityMs
        if let socketLostAtMs {
            nextReconnectAtMs = socketLostAtMs + Self.reconnectBackoffFloorMs
        }
    }

    /// A server frame arrived at the current virtual instant: it refreshes
    /// the freshness budget (every server frame is liveness evidence; the
    /// pong is merely the guaranteed one).
    public func noteServerActivity() {
        lastServerActivityMs = nowMs
    }

    /// Advance the virtual clock by exactly `byMs`, emitting every
    /// timer-driven action whose deadline falls inside the interval.
    public func advance(byMs: UInt64) -> (emissions: [TimedAction], event: MachineEvent) {
        let target = nowMs + byMs
        var emissions: [TimedAction] = []
        var event = MachineEvent(actions: [], resubscribe: [], diagnostics: [])
        while let deadline = nextDeadline(), deadline.atMs <= target {
            nowMs = max(nowMs, deadline.atMs)
            switch deadline.kind {
            case .heartbeatPing:
                emissions.append(TimedAction(atMs: nowMs, action: .sendPing))
                lastPingMs = nowMs
            case .freshnessLoss:
                // T-HB's loss half: the freshness budget passed with the
                // socket still claiming open — declare the socket lost
                // rather than trusting a silent TCP session; T-LOSS drops
                // every durable subscription.
                emissions.append(
                    TimedAction(atMs: nowMs, action: .forceSocketLoss)
                )
                let dropped = machine.noteSocketLost()
                event.resubscribe.append(contentsOf: dropped)
                event.diagnostics.append(
                    "freshness budget exhausted at virtual \(nowMs) ms; socket declared lost"
                )
                lastServerActivityMs = nil
                lastPingMs = nil
                reconnectDelayMs = Self.reconnectBackoffFloorMs
                nextReconnectAtMs = nowMs + Self.reconnectBackoffFloorMs
            case .reconnectAttempt:
                // Bounded backoff: no attempt before the 250 ms floor;
                // delays grow geometrically and cap at 10 s, so consecutive
                // attempts are never further apart than the cap.
                emissions.append(
                    TimedAction(atMs: nowMs, action: .attemptReconnect)
                )
                reconnectDelayMs = min(
                    reconnectDelayMs * 2,
                    Self.reconnectBackoffCapMs
                )
                nextReconnectAtMs = nowMs + reconnectDelayMs
            case .leaseFence:
                let fence = machine.fenceExpiredRetainedReads(
                    nowServerMs: nowMs
                )
                for action in fence.actions {
                    emissions.append(TimedAction(atMs: nowMs, action: action))
                }
                event.diagnostics.append(contentsOf: fence.diagnostics)
            }
        }
        nowMs = target
        event.actions = emissions.map(\.action)
        return (emissions, event)
    }

    private enum DeadlineKind {
        case heartbeatPing
        case freshnessLoss
        case reconnectAttempt
        case leaseFence
    }

    private func nextDeadline() -> (atMs: UInt64, kind: DeadlineKind)? {
        var best: (atMs: UInt64, kind: DeadlineKind)?
        // Every deadline kind strictly progresses its own state when it
        // fires (ping/reconnect reschedule forward; loss changes phase;
        // fencing removes the entry), so same-instant ties are processed
        // without looping.
        func consider(_ atMs: UInt64?, _ kind: DeadlineKind) {
            guard let atMs else { return }
            if best == nil || atMs < best!.atMs { best = (atMs, kind) }
        }
        if machine.phase == .attachedLive {
            consider(
                (lastPingMs ?? 0) + Self.heartbeatIntervalMs,
                .heartbeatPing
            )
            if let activity = lastServerActivityMs {
                consider(activity + Self.freshnessBudgetMs, .freshnessLoss)
            }
        }
        if machine.phase == .recovering {
            consider(nextReconnectAtMs, .reconnectAttempt)
        }
        consider(machine.nextRetainedReadFenceDeadlineMs, .leaseFence)
        return best
    }
}
