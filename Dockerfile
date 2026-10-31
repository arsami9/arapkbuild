
FROM gradle:8.9-jdk17

USER root

ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_BUILD_TOOLS=/opt/android-sdk/build-tools/35.0.0

ENV PATH="${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools/35.0.0"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       curl \
       unzip \
       zip \
       ca-certificates \
       openssl \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" \
    && curl -fsSL \
       https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
       -o /tmp/cmdtools.zip \
    && unzip -q /tmp/cmdtools.zip -d "${ANDROID_HOME}/cmdline-tools" \
    && mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" \
       "${ANDROID_HOME}/cmdline-tools/latest" \
    && rm -f /tmp/cmdtools.zip

RUN yes | sdkmanager --sdk_root="${ANDROID_HOME}" --licenses \
    >/dev/null 2>&1 || true

RUN sdkmanager --sdk_root="${ANDROID_HOME}" \
    "platform-tools" \
    "platforms;android-35" \
    "build-tools;35.0.0" \
    && chmod -R a+rwx "${ANDROID_HOME}"

WORKDIR /srv/arapkbuild

COPY package*.json ./

RUN npm install --omit=dev

COPY server.js ./

RUN mkdir -p /tmp/arapkbuild-builds/uploads \
    && chmod -R 777 /tmp/arapkbuild-builds

ENV NODE_ENV=production
ENV PORT=8080
ENV WORK_DIR=/tmp/arapkbuild-builds

EXPOSE 8080

CMD ["npm", "start"]
