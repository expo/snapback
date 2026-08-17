require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'SnapbackExpoCustody'
  s.version          = package['version']
  s.summary          = package['description']
  s.description      = package['description']
  s.license          = package['license']
  s.author           = 'Expo'
  s.homepage         = package['homepage']
  s.platforms        = { :ios => '16.4' }
  s.swift_version    = '5.9'
  s.source           = { git: 'https://github.com/expo/snapback.git' }
  s.static_framework = true
  s.default_subspec  = 'ExpoModule'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.subspec 'Core' do |core|
    core.source_files = 'SnapbackExpoCustodyCore.swift'
    core.frameworks = 'Security'
  end

  s.subspec 'ExpoModule' do |expo_module|
    expo_module.source_files = 'SnapbackExpoCustodyModule.swift'
    expo_module.dependency 'SnapbackExpoCustody/Core'
    expo_module.dependency 'ExpoModulesCore'
  end
end
