# GoodEats 1.3 submission

The owner handles App Store Connect. No upload or submission is performed by the agent.

## Local archive

Open `artifacts/GoodEats-1.3.xcarchive` in Xcode. The app and widget extension use version 1.3; the local archive starts with build 1. App Store Connect's existing build history has not been inspected. Let Xcode manage the build number during upload to avoid reusing a number.

In Xcode Organizer, select the archive, then **Distribute App → TestFlight & App Store**. If the flow instead presents **App Store Connect**, choose that and **Upload**. Keep automatic signing, symbol upload and **Manage version and build numbers** enabled. Use the normal App Store distribution path; an archive uploaded as **TestFlight Internal Only** cannot later be submitted to the App Store. Review validation results, then upload. Complete Apple sign-in yourself if requested.

Local build/signature verification is separate from Apple's distribution validation and server-side processing. Fix any validation errors before continuing; preserve any warnings for review.

## TestFlight

1. Open App Store Connect → Apps → GoodEats → TestFlight. Wait for version 1.3 to finish processing.
2. Open your internal testing group (or create one), add the processed build, and add yourself as a tester if necessary.
3. Install that build through TestFlight. Check sign-in and reopening, Home/Search/Lists navigation, restaurant details and galleries, photo uploads, notifications, and widgets. Confirm that features work without purchases and no Pro prompts appear. Check iPad layout too because this app supports iPhone and iPad.

## Prepare the App Store version

1. In Apps → GoodEats → Distribution, create iOS version **1.3** using the plus button next to the iOS platform, if it does not already exist. Apple requires the current release to be eligible for creating a new version; resolve any existing pending version first.
2. Select the processed 1.3 build in the Build section.
3. Review screenshots and description against the current app. Remove any promises of paid plans or prices. Keep the app's price Free and leave subscription products out of this submission.
4. Confirm App Privacy disclosures, age-rating answers (including user content and messaging), support/privacy links, export compliance and any account-specific required information. A local privacy manifest does not complete App Store Connect's privacy questionnaire.
5. In App Review Information, supply a working dedicated review account, its credentials, your contact details and the notes below. Enter credentials in App Store Connect directly, not in this document.
6. Select manual release if you want to decide when the approved version becomes public. Save, choose **Add for Review**, review the submission, then **Submit for Review** when ready.

### Suggested What's New

GoodEats is now fully free. This update improves restaurant photo galleries, page loading, navigation, sign-in persistence, and the startup experience, with additional reliability and privacy improvements.

### Suggested review notes

Version 1.3 is fully free. All available features can be used without a purchase or subscription, subject to ordinary service usage limits. No in-app purchases are offered in this version. Use the supplied review account for features that require sign-in. Account deletion is available in Settings under Account & security.

## Apple references

- [Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)
- [Distribute with Xcode](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
- [Internal TestFlight testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers)
- [Create a new version](https://developer.apple.com/help/app-store-connect/update-your-app/create-a-new-version)
- [App Review preparation](https://developer.apple.com/app-store/review/)

## Local verification completed

The Release archive built successfully with Xcode 26.6 / iOS 26.5 SDK. App and widget both report version 1.3, build 1. The app uses the production push environment, contains no development server override, and bundles the freshly built web assets. Code-signature verification passed; four dSYM bundles are included. Apple upload validation and processing remain for the owner to perform.
