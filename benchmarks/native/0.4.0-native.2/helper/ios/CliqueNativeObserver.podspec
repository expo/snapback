Pod::Spec.new do |s|
  s.name = 'CliqueNativeObserver'
  s.version = '0.4.0-native.2'
  s.summary = 'Passive, local native benchmark observations'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Snapback benchmark'
  s.homepage = 'https://github.com/ccheever/snapback'
  s.platforms = { :ios => '16.0' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.swift_version = '5.0'
end
