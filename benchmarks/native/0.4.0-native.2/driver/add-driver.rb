require 'xcodeproj'
project_path, swift_path = ARGV
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.product_type == 'com.apple.product-type.application' }
raise 'No application target' unless app
raise 'Driver already exists' if project.targets.any? { |t| t.name == 'CliqueDriver' }
target = project.new_target(:ui_test_bundle, 'CliqueDriver', :ios, '17.0')
# It targets arbitrary installed apps; the scheme builds only this independent runner.
target.build_configurations.each do |config|
 config.build_settings.merge!({'PRODUCT_BUNDLE_IDENTIFIER'=>'dev.clique.ni.driver','GENERATE_INFOPLIST_FILE'=>'YES',
 'SWIFT_VERSION'=>'5.0','TARGETED_DEVICE_FAMILY'=>'1','CODE_SIGNING_ALLOWED'=>'NO','PRODUCT_NAME'=>'CliqueDriver','ONLY_ACTIVE_ARCH'=>'YES'})
end
file=project.main_group.new_file(File.expand_path(swift_path));target.source_build_phase.add_file_reference(file)
project.save
scheme=Xcodeproj::XCScheme.new
scheme.add_build_target(app);scheme.add_build_target(target);scheme.add_test_target(target)
scheme.test_action.build_configuration='Release';scheme.save_as(project.path,'CliqueDriver',true)
