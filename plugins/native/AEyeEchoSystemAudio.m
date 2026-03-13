#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(AEyeEchoSystemAudio, RCTEventEmitter)

RCT_EXTERN_METHOD(startCapture:(NSString *)locale)
RCT_EXTERN_METHOD(stopCapture)
RCT_EXTERN_METHOD(setLanguage:(NSString *)locale)
RCT_EXTERN_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
