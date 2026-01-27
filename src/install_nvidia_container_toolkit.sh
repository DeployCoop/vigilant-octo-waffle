#!/usr/bin/env bash
NV_CTK_TMP=$(mktemp -d --suffix '.tmp' nvctk.XXXXXXXXX)
trap 'rm -rf ${NV_CTK_TMP}' EXIT
. /etc/os-release

build_yay () {
  cd "${NV_CTK_TMP}" || exit 1
  # 1. Update your system and install prerequisites (git & base-devel)
  sudo pacman -S --needed base-devel git
  # 2. Clone the yay repository from the AUR
  git clone https://aur.archlinux.org/yay.git
  # 3. Navigate into the cloned yay directory
  cd yay
  # 4. Build and install yay
  makepkg -si
}

apt_update () {
  sudo apt-get update && sudo apt-get install -y --no-install-recommends \
    curl \
    gnupg2
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg \
    && curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
  sudo apt-get update
  export NVIDIA_CONTAINER_TOOLKIT_VERSION=1.18.1-1
  sudo apt-get install -y \
    nvidia-container-toolkit=${NVIDIA_CONTAINER_TOOLKIT_VERSION} \
    nvidia-container-toolkit-base=${NVIDIA_CONTAINER_TOOLKIT_VERSION} \
    libnvidia-container-tools=${NVIDIA_CONTAINER_TOOLKIT_VERSION} \
    libnvidia-container1=${NVIDIA_CONTAINER_TOOLKIT_VERSION}
}

pacman_update () {
  sudo pacman -Syu --noconfirm \
    curl \
    gnupg
  if ! command -v yay &> /dev/null
  then
    echo "yay does not exist. Attempting to install it."
    build_yay
  fi
  yay -S nvidia-container-toolkit
}

try_update () {
  if [ "${NAME}" = "Arch Linux" ]; then
    pacman_update
  elif [ "${ID}" = "ubuntu" ] || [ "${ID}" = "debian" ] || [ "${ID}" = "Linux Mint" ]; then
    apt_update
  elif [ "${NAME}" = "NixOS" ]; then
    # nix_update
    echo 'Unimplemented!'
    exit 1
  else
    echo "unknown os = ${NAME} bailing out!"
    exit 1
  fi
}

configure_ctk () {
  TARGET_CTK=$1
  sudo nvidia-ctk runtime configure --runtime=${TARGET_CTK}
  sudo systemctl restart ${TARGET_CTK}
}

configure_checker () {
  TARGET_CHECK=$1
  if command -v ${TARGET_CHECK} &> /dev/null
  then
    configure_ctk ${TARGET_CHECK}
  fi
}

main () {
  try_update
  configure_checker docker
  configure_checker containerd 
  configure_checker crio
}

time main $@
