plugins {
    id("com.android.application")
}

android {
    namespace = "com.bingocontrolpro.ecuador"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.bingocontrolpro.ecuador"
        minSdk = 24
        targetSdk = 36
        // Play Store requires a higher version code for the rebuilt package.
        versionCode = 7
        versionName = "1.3.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
