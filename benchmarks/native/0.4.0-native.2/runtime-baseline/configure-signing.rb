#!/usr/bin/env ruby
require 'xcodeproj'

project_path, entitlements = ARGV
abort('usage: configure-signing.rb PROJECT ENTITLEMENTS') unless project_path && entitlements
project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |candidate| candidate.product_type == 'com.apple.product-type.application' }
abort('application target missing') unless target
target.build_configurations.each do |configuration|
  configuration.build_settings['CODE_SIGN_ENTITLEMENTS'] = entitlements
  configuration.build_settings['CODE_SIGNING_ALLOWED'] = 'YES'
  configuration.build_settings['CODE_SIGN_IDENTITY'] = '-'
  configuration.build_settings['DEVELOPMENT_TEAM'] = ''
  configuration.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = ''
end
project.save
