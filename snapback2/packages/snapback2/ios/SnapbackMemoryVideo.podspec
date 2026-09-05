require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name = 'SnapbackMemoryVideo'
  s.version = package['version']
  s.summary = 'In-memory view-once video playback for Snapback'
  s.description = s.summary
  s.license = package['license']
  s.author = 'Expo'
  s.homepage = 'https://github.com/expo/snapback'
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/expo/snapback.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVKit', 'AVFoundation', 'UniformTypeIdentifiers'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
