FROM gradle:8.9-jdk17
USER root
ENV ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk ANDROID_BUILD_TOOLS=/opt/android-sdk/build-tools/35.0.0
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip zip ca-certificates && rm -rf /var/lib/apt/lists/* \
 && mkdir -p ${ANDROID_HOME}/cmdline-tools \
 && curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/cmdtools.zip \
 && unzip -q /tmp/cmdtools.zip -d ${ANDROID_HOME}/cmdline-tools \
 && mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest \
 && rm /tmp/cmdtools.zip
ENV PATH=${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools/35.0.0
RUN yes | sdkmanager --licenses >/dev/null 2>&1 || true \
 && sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" \
 && chmod -R a+rwx ${ANDROID_HOME}
WORKDIR /srv/wevlo
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
RUN mkdir -p /tmp/wevlo-builds && chmod 777 /tmp/wevlo-builds
ENV PORT=8080
EXPOSE 8080
CMD ["npm","start"]
