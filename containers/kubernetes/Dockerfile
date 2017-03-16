FROM fedora:25

ARG RELEASE=1
ARG VERSION=135
ARG COCKPIT_RPM_URL
ARG INSTALLER
ARG OFFLINE
ARG USE_REPO

ADD . /container
RUN /container/install.sh

CMD ["/usr/libexec/cockpit-kube-launch"]
