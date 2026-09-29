// @ref LLP 3000.030#4 — exact generated Expo 57 / RN 0.86 / CocoaPods 1.17 script forms.
// Unknown scripts need an own build; a name alone never grants repack eligibility.
export const phaseHashes = new Set([
  "00ae9f1f54878059fe8373fd4b06cbf0c93dbadb949d9fdafff9441d2c189f70", // [CP-User] [Expo] Resolve ExpoFont dSYM source maps
  "040ad4446562a62eb8aac582bc2aa20f0887630b8f8bcc377271782a14aa4f5b", // Copy generated compatibility header
  "04154ec1ba16d2463cf4aa3de08b0f51692d9f5bc679b9f819ad93559e68c5be", // Copy generated compatibility header
  "0da9c8c9a4efd5c65f3cdc427f09a75bc4720c921c30b8f886c73513fe4e4595", // [CP-User] [Hermes] Replace Hermes for the right configuration, if needed
  "0e3265ef70386a9bcc003c8a34901558b87136822c4c245a2b728d7d7c3ca053", // Copy generated compatibility header
  "0f621052018755a1110658b3cee5ab27fd355eae247f76996f689a68fa6d5b99", // [CP] Copy XCFrameworks
  "136daf00a8ba713737fb35b4ba2fee69546a049aefd233e2dbcf9303124a7c6a", // [CP] Copy XCFrameworks
  "18ff6e677bc4f2d8a11a04d922b12acf168236f5303b1d1550954d901a1da619", // Copy generated compatibility header
  "1aba764f5e58612080ca9486bd9bbba6e6c0b6ae842a1600069c9aba158503ab", // [CP] Copy XCFrameworks
  "1af649c61fa3053e3f0d22c9b9c26ca25d0c10c2db1db5aa0bc1c1abdd54788f", // Copy generated compatibility header
  "1db7f67becf9a8f02fa44ef7d99b984f73855656210be94b7f629e7c676656b0", // [Expo] Remove duplicate codegen output
  "216ce2ed98ec4986fff3aa1cb4d46d2a714eb1da6e77a2bef1216d7c5241944d", // [CP-User] Generate Specs
  "25003fb999b4f69c9a7788555c8c41d60f682e2ca7dca32a3c5d1b98f95b7922", // [CP] Copy XCFrameworks
  "25e066578ad6c40a490d555815033531f8f710396707a6e60b98b104591ee8ca", // Copy generated compatibility header
  "28943aec3652e14ca57708fd2862210a7694a9f94bfd88245ccf4f331cc835e1", // Bundle React Native code and images
  "2c701f6e5faa1b7fc2fa723f966bc6095ba0ed0bba18b9d45e2b8e4eb0a54ab0", // [Expo Dev Launcher] Strip Local Network Keys for Release
  "2f76409952f40aa21158125b80e205dc89ee9b693b425bbad2200c98a300183c", // Copy generated compatibility header
  "3f3812439ab39edf5a02ff7e801289a39553415cad6153dd0defa9f70a0503b7", // [CP-User] [Expo] Resolve ExpoModulesWorklets dSYM source maps
  "49987658b902be328e98da33ba80b146e8dd84f15ed7afd45484b82fa0c00df8", // [CP] Copy Pods Resources
  "4ce2ee0c833311e4afac14a24257d64f17d796e2ad4f930d53f6e23f95901321", // Copy generated compatibility header
  "56de00a401443c5690116bc8ccb5f57f4458a218dc8a4098efab480feac9d9f1", // Copy generated compatibility header
  "5adf3d524932088109f573d4d3ec6124b3b032474a044f61355d1cb0a78a6b5c", // [CP-User] [RNCore] Replace React Native Core for the right configuration, if needed
  "5c02b249e909bdc1465accd681c345942e2d0d2dad114b757e171d5ca8045947", // [CP-User] Generate app.config for prebuilt Constants.manifest
  "6068f7ea8640fd0dbb33cafa1c3c3e9e879650cdf575ea7a2f706d913924a889", // [CP-User] [Expo] Switch ExpoModulesCore XCFramework for build configuration
  "6f450fb1d31a518da38a1b2c2ce458ce11a756ff13ed9aa9dd92376bf99b32dd", // Copy generated compatibility header
  "79f1e0cdf4d39d6335071a3573faced8218f861239a7d46421c1d2f40fdf5acd", // [CP-User] [Expo] Resolve ExpoFileSystem dSYM source maps
  "7ba52593750d813bef5cce71896e828eef87c3e069f058775773bcf15f5ab5b1", // [CP] Copy XCFrameworks
  "8a2afedf045c549fc15439e8cbf75971c6ceb54abeeea9bb53c8947be670b3c3", // [CP] Copy XCFrameworks
  "94150339eb9e3a7c1cbf1f5ac7174b67595c21c87805237ec5d4f42e27832bca", // [CP-User] Build ExpoModulesJSI xcframework
  "95d317f7fe9568c74f25360f75bf93f42e86722f700e2d7e5f521ff121430bd2", // [CP] Copy XCFrameworks
  "9658398ede4176f2676e0c2fc9b8f3f682c812d4877b0a5629442f4c54e2aaf1", // Copy generated compatibility header
  "968edc996785bebc9a06b5be9d83a9c602816c98dea24db9de7f09e989494387", // [CP] Copy XCFrameworks
  "998d0d43cbf0d97e8639f8c4de79eef30d6416b902c31849ab7d8487f4727e75", // Copy generated compatibility header
  "9c449cbd4588dc1aca2250263fdd26dcf6b6f2b651384e4c4e37ccef810729c5", // Copy generated compatibility header
  "a6455256f04a9767de11fe43e1b6bb29ee34a1ed3733acca85b4323edfb5f351", // [CP-User] [RNDeps] Replace React Native Dependencies for the right configuration, if needed
  "a65c0ebe34b8033849e1b74d234db1bd9ca6743bf8557f15b2cf4834652de506", // [CP] Copy XCFrameworks
  "a84e4ecbaa87c83a53da606ab71d71d1a55ba4768ecc571dd7cfb1f01963e5bb", // [CP-User] [Expo] Switch ExpoModulesWorklets XCFramework for build configuration
  "b52e61a107f00dcfc0f323890a0b4597cefc3fafb6118cd6f322e73c425a425d", // Copy generated compatibility header
  "b956bcf63913fac18538e698a6beb0e9afe582937cfdb22b59caaf3934d47251", // [CP] Embed Pods Frameworks
  "c2b61a18762523c18529292421af97bbf7562c0f623995d01e9a2b39dfc60cde", // Copy generated compatibility header
  "c2da353c921ad7d5446da394a4bc3d8a198d8a956fd8607afa6f134bd27ba253", // [CP-User] [Expo] Switch ExpoVideo XCFramework for build configuration
  "c7d571321494537690ca003c362f4bdba5d60139b54b91fcd2a6e41e408ca88e", // [CP-User] [Expo] Resolve ExpoVideo dSYM source maps
  "cd5f9bfc720f5d369847631129e4eacca6a571fefbfb46bfb76ea84665049380", // Copy generated compatibility header
  "cf7c919bd57353bcdee93f83cfc8537e46bc569bb74c08df8447e15dea4d2e2a", // Copy generated compatibility header
  "cfda42d32bd391d32ca2786de8610c0264d40c2e45f47213254ccdafd2c12c1e", // Copy generated compatibility header
  "d07c96b69633711210d8c0c9b5324aff1e80054d22318ee4a5850c3ba931ea59", // [Expo] Configure project
  "d3d308fd6509e72458bb5d6deea5ae97730db67e9bdf91ef2b9d1ba3fddb7719", // [CP-User] [Expo] Switch ExpoFont XCFramework for build configuration
  "d6ccc999b1f44e424b2dd33e8e7f95851df861d961cb6278d98ea406fcb8bd9c", // Copy generated compatibility header
  "d8f368a882105aed87e080e847324c3d9f7fbc31b3b634391d1c5964a3dea92a", // [CP-User] [RN]Check FBReactNativeSpec
  "df2c39a7fc2c6a2c7afb1ac8ff6eac565cf4644b365ba2930d9d758dc375a823", // [CP] Copy XCFrameworks
  "e842ee32f5389a60133f1bc4b998e62f394a08fe84ca860a0f707ef4177db9d8", // [CP-User] [Expo] Resolve ExpoModulesCore dSYM source maps
  "e9a36f02b2d2d9312ed156bdbf18ffcbf6929be0d694703cdaa21b6f991811bf", // [CP-User] [Expo] Switch ExpoFileSystem XCFramework for build configuration
  "f27ea9d89e0c46c0d4633696a1334ef50d5a8c9584c538e9eebfb38b0b62e9a7", // [CP] Check Pods Manifest.lock
  "f4def4c75e80a6f5ec28577bbe97bb137505469622a63cddb777c36c4b62c7fd", // Copy generated compatibility header
  "ffc4efb54b0066df720d0726664c58aba4ce508d9ef8b5b6f3de6bebb0618942", // Copy generated compatibility header
]);
export const supportHashes = new Set([
  "278060e214e1d8d2c491eb05bb51e16c45756d0c820283d22cff7ea64091920c", // ios/Pods/Target Support Files/Pods-Clique/Pods-Clique-frameworks.sh
  "5031d23feaa6e2d04637573db121d7fed7b726dfa5f310b23b03bdf8e211babb", // ios/Pods/Target Support Files/ExpoModulesJSI/ExpoModulesJSI-xcframeworks.sh
  "6b58124b086b7114b52fec7d997c242901fe27bb11f08dc46ccb72a4dbdf1c03", // ios/Pods/Target Support Files/ExpoModulesWorklets/ExpoModulesWorklets-xcframeworks.sh
  "803ec1a055651a5dc63961941a02381ec61cab2f654c06df2a77304886f21cd0", // ios/Pods/Target Support Files/Pods-Clique/Pods-Clique-resources.sh
  "8a4e676e593a80e9200074eb2fab1fd286be154a238adeaa083aee67705dbae6", // ios/Pods/Target Support Files/React-Core-prebuilt/React-Core-prebuilt-xcframeworks.sh
  "8d4ec958670a726e8c30e732a671b0517c941299254b8c66a4efb3ad2799cc01", // ios/Pods/Target Support Files/ExpoFileSystem/ExpoFileSystem-xcframeworks.sh
  "98bf1e7fa9f74af22bbc482789c50f279b46e232027ac71e69e61b8539c3ccae", // ios/Pods/Target Support Files/Snapback4Expo/Snapback4Expo-xcframeworks.sh
  "999e144f16baff093dad7385011b4f06bc061d51d384040266b76212ae1698dc", // ios/Pods/Target Support Files/ExpoModulesCore/ExpoModulesCore-xcframeworks.sh
  "b2b1ba2bfd94de043ef1884abfadf9674419f84c647abc6afc4fd9293f5fbac4", // ios/Pods/Target Support Files/ReactNativeDependencies/ReactNativeDependencies-xcframeworks.sh
  "d36d68333e52a3e0536cd5e9e26779aec3962a71feb63da1b703009552ff55f1", // ios/Pods/Target Support Files/ExpoVideo/ExpoVideo-xcframeworks.sh
  "dc0598267c59befc06db2a5471663ea0a631da8e93733c5d2b97d0c49d3d415c", // ios/Pods/Target Support Files/Pods-Clique/expo-configure-project.sh
  "de5e1d9af3832515c6d4cdd892020fdd4c12ecca4d17b6a75337493c1dd1b9b8", // ios/Pods/Target Support Files/ExpoFont/ExpoFont-xcframeworks.sh
  "e736a5641e823b1882a2030a6e7211bc0eebbc5d85338ea715db707091df6f4b", // ios/Pods/Target Support Files/hermes-engine/hermes-engine-xcframeworks.sh
]);

// Shell/Node phases and the Swift macro executable can read undeclared inputs.
// Reuse with those tools is limited to this qualified installed dependency tree;
// changing it still permits --build, but needs a new adapter qualification for repack.
export const qualifiedScriptTooling = '80ff62f08d660ed17c8ac842a765ef96dbc11ad73635996d9c395494f74b1856';
