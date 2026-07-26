import Foundation
import CoreFoundation

/// A minimal JSON tree used for all wire decoding.
///
/// The wire decoders below are hand-rolled over this tree instead of relying
/// on `Codable` synthesis, because LLP 0094 §0C.2's acceptance grammar
/// ("skip, never crash" on unknown kinds and unknown fields) is a property we
/// want by construction, not by accident: every decoder here (a) dispatches on
/// the tag and falls back to an explicit `.unknown` case, and (b) can report
/// the presence of unknown members so the conformance harness can prove
/// tolerance (LLP 0095 fixture `negative.unknown_field.tolerated`).
public enum JSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case int(Int64)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public static func parse(_ data: Data) throws -> JSONValue {
        let raw = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        return JSONValue(raw: raw)
    }

    public static func parse(_ text: String) throws -> JSONValue {
        try parse(Data(text.utf8))
    }

    init(raw: Any) {
        switch raw {
        case is NSNull:
            self = .null
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                self = .bool(number.boolValue)
            } else if let intValue = Int64(exactly: number) {
                self = .int(intValue)
            } else {
                self = .double(number.doubleValue)
            }
        case let text as String:
            self = .string(text)
        case let list as [Any]:
            self = .array(list.map { JSONValue(raw: $0) })
        case let map as [String: Any]:
            self = .object(map.mapValues { JSONValue(raw: $0) })
        default:
            self = .null
        }
    }

    public var rawValue: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let value): return value
        case .int(let value): return NSNumber(value: value)
        case .double(let value): return NSNumber(value: value)
        case .string(let value): return value
        case .array(let values): return values.map { $0.rawValue }
        case .object(let members): return members.mapValues { $0.rawValue }
        }
    }

    public func encoded() throws -> Data {
        try JSONSerialization.data(withJSONObject: rawValue, options: [.fragmentsAllowed, .sortedKeys])
    }

    // MARK: accessors

    public var objectValue: [String: JSONValue]? {
        if case .object(let members) = self { return members }
        return nil
    }

    public var arrayValue: [JSONValue]? {
        if case .array(let values) = self { return values }
        return nil
    }

    public var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    public var boolValue: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    public var uint64Value: UInt64? {
        switch self {
        case .int(let value) where value >= 0: return UInt64(value)
        case .double(let value) where value >= 0 && value == value.rounded(): return UInt64(value)
        default: return nil
        }
    }

    public subscript(key: String) -> JSONValue? {
        objectValue?[key]
    }

    /// Byte-array decoding for `payload: [u8…]` members (the drain wrapper and
    /// `durable_bytes`). Returns nil when any element is out of range —
    /// callers treat that as an undecodable payload, never a crash.
    public var byteArrayValue: [UInt8]? {
        guard let values = arrayValue else { return nil }
        var bytes: [UInt8] = []
        bytes.reserveCapacity(values.count)
        for value in values {
            guard case .int(let element) = value, (0...255).contains(element) else { return nil }
            bytes.append(UInt8(element))
        }
        return bytes
    }
}
