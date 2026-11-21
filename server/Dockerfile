# HARIS Moongazer container. Based on the original Docker setup by Yash Brid (SooratiLab/haris PR #19).
#   docker compose up --build        (from server/), then open http://localhost:44101
# The Google Maps key is passed at run time via HARIS_MAPS_KEY; never bake it into the image.
FROM gradle:8.14.3-jdk21 AS build
WORKDIR /src
COPY --chown=gradle:gradle build.gradle settings.gradle ./
COPY --chown=gradle:gradle src ./src
RUN gradle --no-daemon -q installDist

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/build/install/haris-moongazer /opt/haris
COPY web ./web
COPY logging.properties loggingForStudy.properties ./
RUN mkdir -p log
EXPOSE 44101
# Optional: mount a Linux PRISM 4.8 install and set PRISM_HOME for the prediction features.
ENV JAVA_OPTS=""
CMD ["/opt/haris/bin/haris-moongazer"]
