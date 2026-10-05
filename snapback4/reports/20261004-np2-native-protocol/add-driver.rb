require 'xcodeproj'
# Feasibility-only target added to the COPY; no production or frozen kit edit.
project = Xcodeproj::Project.open('app/ios/Clique.xcodeproj')
app = project.targets.find { |t| t.name == 'Clique' }
app.build_configurations.each { |c| c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'dev.snapback.np2.cal30' }
target = project.targets.find { |t| t.name == 'NP2Driver' } || project.new_target(:ui_test_bundle, 'NP2Driver', :ios, '17.0')
target.add_dependency(app)
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'dev.snapback.np2.driver',
    'GENERATE_INFOPLIST_FILE' => 'YES', 'TEST_TARGET_NAME' => 'Clique',
    'SWIFT_VERSION' => '5.0', 'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGNING_ALLOWED' => 'NO', 'PRODUCT_NAME' => 'NP2Driver',
    'ONLY_ACTIVE_ARCH' => 'YES'
  })
end
unless target.source_build_phase.files_references.any? { |f| f.path == '../../NativeProbe.swift' }
  file = project.main_group.new_file('../../NativeProbe.swift')
  target.source_build_phase.add_file_reference(file)
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.test_action.build_configuration = 'Release'
scheme.save_as(project.path, 'NP2Driver', true)
