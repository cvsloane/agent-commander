plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.heaviside.agentcommand"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.heaviside.agentcommand"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "0.2.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        jniLibs.excludes += setOf(
            "lib/*/libtermux.so",
            "lib/*/liblocal-socket.so",
        )
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.github.termux.termux-app:terminal-view:0.118.3")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250107")
}
