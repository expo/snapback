# Shared Ibex/Hermes artifact detection (LLP 0032 P7): one source of truth
# for what a working bring-up looks like, consumed by both
# scripts/bootstrap-ibex-runtime (which repairs) and scripts/ibex-doctor
# (which diagnoses with structured remediation).
#
# Callers may define IBEX_ARTIFACTS_LOG to receive missing-artifact reasons;
# it defaults to a no-op.

ibex_artifacts_log() {
    if [ -n "${IBEX_ARTIFACTS_LOG:-}" ]; then
        "$IBEX_ARTIFACTS_LOG" "$@"
    fi
}

ibex_target_os() {
    uname -s | tr '[:upper:]' '[:lower:]'
}

ibex_hermes_arch() {
    case "$(uname -m)" in
        arm64|aarch64) printf 'arm64' ;;
        x86_64|amd64) printf 'x64' ;;
        *) uname -m ;;
    esac
}

ibex_has_tool() {
    local base="$1"
    local tool="$2"
    shift 2

    local candidate
    for candidate in "$@"; do
        if [ -f "$base/tools/hermes/$candidate" ]; then
            return 0
        fi
    done

    ibex_artifacts_log "$tool missing under $base/tools/hermes"
    return 1
}

ibex_has_macos_framework() {
    local base="$1"
    local frameworks="$base/ios/Frameworks"
    local candidate

    for candidate in \
        "$frameworks/hermes.framework/hermes" \
        "$frameworks/hermes.framework/Versions/Current/hermes" \
        "$frameworks/hermes.framework/Versions/1/hermes" \
        "$frameworks/hermes.framework/Versions/0/hermes" \
        "$frameworks/macosx/hermes.framework/hermes" \
        "$frameworks/macosx/hermes.framework/Versions/Current/hermes" \
        "$frameworks/macosx/hermes.framework/Versions/1/hermes" \
        "$frameworks/macosx/hermes.framework/Versions/0/hermes" \
        "$frameworks/hermesvm.framework/hermesvm" \
        "$frameworks/hermesvm.framework/Versions/Current/hermesvm" \
        "$frameworks/hermesvm.framework/Versions/1/hermesvm" \
        "$frameworks/hermesvm.framework/Versions/0/hermesvm" \
        "$frameworks/hermes.xcframework/macos-arm64_x86_64/hermes.framework/hermes" \
        "$frameworks/hermes.xcframework/macos-arm64_x86_64/hermes.framework/Versions/Current/hermes" \
        "$frameworks/hermes.xcframework/macos-arm64_x86_64/hermesvm.framework/hermesvm" \
        "$frameworks/hermes.xcframework/macos-arm64_x86_64/hermesvm.framework/Versions/Current/hermesvm" \
        "$frameworks/hermes.xcframework/macos-arm64/hermes.framework/hermes" \
        "$frameworks/hermes.xcframework/macos-arm64/hermes.framework/Versions/Current/hermes" \
        "$frameworks/hermes.xcframework/macos-arm64/hermesvm.framework/hermesvm" \
        "$frameworks/hermes.xcframework/macos-arm64/hermesvm.framework/Versions/Current/hermesvm"
    do
        if [ -f "$candidate" ]; then
            return 0
        fi
    done

    ibex_artifacts_log "macOS Hermes framework missing under $frameworks"
    return 1
}

ibex_has_darwin_headers() {
    local base="$1"
    local frameworks="$base/ios/Frameworks"

    [ -f "$frameworks/hermes-headers/hermes/hermes.h" ] || {
        ibex_artifacts_log "Hermes headers missing under $frameworks/hermes-headers"
        return 1
    }
    [ -f "$frameworks/hermes-headers/jsi/jsi.h" ] || {
        ibex_artifacts_log "JSI headers missing under $frameworks/hermes-headers"
        return 1
    }
}

ibex_has_linux_headers() {
    local base="$1"

    [ -f "$base/linux/hermes-headers/hermes/hermes.h" ] || {
        ibex_artifacts_log "Linux Hermes headers missing under $base/linux/hermes-headers/hermes"
        return 1
    }
    [ -f "$base/linux/hermes-headers/jsi/jsi.h" ] || {
        ibex_artifacts_log "Linux JSI headers missing under $base/linux/hermes-headers/jsi"
        return 1
    }
}

ibex_has_linux_runtime() {
    local base="$1"

    [ -d "$base/linux/lib" ] || {
        ibex_artifacts_log "Linux Hermes lib dir missing under $base/linux/lib"
        return 1
    }
    find "$base/linux/lib" -name 'libhermesvm*' -print -quit | grep -q . || {
        ibex_artifacts_log "libhermesvm missing under $base/linux/lib"
        return 1
    }
}

ibex_has_hermesc() {
    local base="$1"
    local os="$2"
    local arch="$3"
    ibex_has_tool "$base" "hermesc" "hermesc-$os-$arch" "hermesc"
}

ibex_has_darwin_artifacts() {
    local base="$1"
    local arch="$2"

    ibex_has_darwin_headers "$base" || return 1
    ibex_has_macos_framework "$base" || return 1
    ibex_has_hermesc "$base" "macos" "$arch" || return 1
}

ibex_has_linux_artifacts() {
    local base="$1"
    local arch="$2"

    ibex_has_linux_headers "$base" || return 1
    ibex_has_linux_runtime "$base" || return 1
    ibex_has_hermesc "$base" "linux" "$arch" || return 1
}

# Returns 0 when the base has a complete artifact set for this host, 1 when
# incomplete, 2 when the host OS is unsupported.
ibex_has_target_artifacts() {
    local base="$1"
    local os
    local arch
    os="$(ibex_target_os)"
    arch="$(ibex_hermes_arch)"

    case "$os" in
        darwin) ibex_has_darwin_artifacts "$base" "$arch" ;;
        linux) ibex_has_linux_artifacts "$base" "$arch" ;;
        *) return 2 ;;
    esac
}
