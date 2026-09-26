# The linked simulator archive is the rebuilt framework; the installed app is the Release build.
import pathlib,json,hashlib,subprocess,plistlib,re
root=pathlib.Path.cwd(); artifacts=root/'reports/20260926-expo-0.4.3'; qpath=artifacts/'qualified.json'; q=json.loads(qpath.read_text())
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==q['source'], 'HEAD moved since preparation'
log=(root/'apps/chat-expo/.expo/xcodebuild.log').read_text(); derived=pathlib.Path(re.search(r'Build description path: (.*?)/Build/',log)[1])
linked=derived/'Build/Products/Release-iphonesimulator/XCFrameworkIntermediates/Snapback4Expo/libsnapback4_device.a'
built=root/'packages/snapback4-expo/ios/Snapback4Device.xcframework/ios-arm64-simulator/libsnapback4_device.a'
assert digest(built)==q['xcframework']['ios/Snapback4Device.xcframework/ios-arm64-simulator/libsnapback4_device.a'],'framework changed since preparation'
assert digest(linked)==digest(built),'linked archive differs from rebuilt framework'
app=root/'target/expo-release/Snapback4chat.app'; info=plistlib.loads((app/'Info.plist').read_bytes()); exe=info['CFBundleExecutable']
udid='81961F7D-DF85-4A7A-B376-20D9073AC101'; installed=pathlib.Path(subprocess.check_output(['xcrun','simctl','get_app_container',udid,'dev.snapback4.chat','app'],text=True).strip())
assert digest(app/exe)==digest(installed/exe),'installed executable differs from Release build'
assert digest(app/'main.jsbundle')==digest(installed/'main.jsbundle'),'installed bundle differs from Release build'
cli=root/'target/debug/snapback4'
assert subprocess.check_output([str(cli),'--version'],text=True).strip().endswith('0.4.3'),'CLI version is not 0.4.3'
q['linkedNativeArchive']={'built':str(built),'linked':str(linked),'sha256':digest(built),'matches':True}; q['app']={'built':str(app),'installed':str(installed),'executable':exe,'sha256':digest(app/exe),'bundleSha256':digest(app/'main.jsbundle'),'installedMatches':True,'bundleId':info['CFBundleIdentifier']};q['cli']={'path':str(cli),'sha256':digest(cli)};q['simulator']=udid;q['port']=44441
qpath.write_text(json.dumps(q,indent=2)+'\n');print(json.dumps({k:q[k] for k in ['linkedNativeArchive','app','cli']},indent=2))
