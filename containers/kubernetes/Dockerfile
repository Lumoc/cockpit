FROM fedora:24

ARG RELEASE=1
ARG VERSION=121
ARG COCKPIT_RPM_URL
ARG INSTALLER
ARG OFFLINE

ADD . /container
RUN /container/install.sh

CMD ["/usr/libexec/cockpit-kube-launch"]
