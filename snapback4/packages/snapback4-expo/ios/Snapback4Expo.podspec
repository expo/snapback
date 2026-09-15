require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'Snapback4Expo'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'Snapback'
  s.homepage       = 'https://github.com/ccheever/snapback'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'

  # The Rust module: both iOS targets, the C header and its module map,
  # built by scripts/build-xcframework.sh.
  s.vendored_frameworks = 'Snapback4Device.xcframework'
  s.source_files = '*.swift'
  # The xcframework carries arm64 device and arm64 simulator slices only, so a
  # Release simulator build (which otherwise builds x86_64 too) must not ask
  # for an Intel slice: exclude it for simulator SDKs in the pod and the app.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64'
  }
  s.user_target_xcconfig = {
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64'
  }
end
