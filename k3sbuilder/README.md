**Overview

k3sbuilder is a small collection of Bash utilities that automate common tasks when provisioning, configuring, and managing a k3s (light‑weight Kubernetes) cluster on a set of remote hosts.  
The scripts rely on simple text files (targets, registries.yaml, templates) and GNU parallel to run commands concurrently across all nodes.

**Repository Structure

k3sbuilder/
├─ filecopierrr.tpl      # scp copy of a helper script to each host
├─ filerunnerrr.sh       # copy then execute a script on all hosts
├─ filerunnerrr.tpl      # ssh command that runs the copied script
├─ joiner.sh             # join a new node to an existing cluster
├─ joinr.tpl              # template used by joiner.sh
├─ kill.sh               # uninstall k3s from every host
├─ killr.tpl              # template used by kill.sh
├─ kmod.sh               # load kernel modules & install kmod on hosts
├─ kmodr.tpl              # ssh command to load modules
├─ modr.sh               # remove kernel modules from hosts
├─ modr.tpl               # ssh command to remove modules
├─ ping.sh               # health‑check (hostname, uptime, IP) on all hosts
├─ ping.tpl               # template used by ping.sh
├─ registries.sh         # copy `registries.yaml` to the host’s k3s config dir
├─ registries.yaml       # container registry mirrors for k3s
├─ up.sh                 # install and start k3s on the main host, copy kubeconfig
├─ vanilla_rebuild.sh    # (placeholder) script for a clean rebuild
└─ targets               # **list of hostnames/IPs** (one per line) used by all scripts

**Prerequisites

* Bash (≥ 4.2) and GNU parallel installed on the control machine.  
* SSH access (key‑based) to each host listed in targets.  
* The control machine must have the k3s install script (src/install_k3s.sh) available at /root/vigilant-octo-waffle/ (as referenced by up.sh).  
* A file ~/.secrets/k3s_env containing any required environment variables (used by joiner.sh).  
Quick Start
1. Populate targets – one hostname or IP per line.
      host1.example.com
   host2.example.com
   host3.example.com
   
2. Install k3s on the primary node
      ./up.sh
   
   * Copies registries.yaml to /etc/rancher/k3s/.  
   * Runs the local install script (install_k3s.sh).  
   * Copies the generated kubeconfig to ~/.kube/config.
3. Add additional nodes to the cluster
      ./joiner.sh
   
   The script expands joinr.tpl with each target and runs the resulting commands in parallel.
4. Load required kernel modules on every host (NVMe‑over‑TCP, etc.)
      ./kmod.sh
   
5. Run a health‑check
      ./ping.sh
   
   Shows each host’s hostname, uptime and IP addresses.
6. Tear down the cluster
      ./kill.sh
   
   Executes the official k3s-uninstall.sh script on every node in parallel.

Script Details

Common Pattern

All scripts share a similar flow:
1. Read targets → shuffle → store in $TARGETS.  
2. Create a temporary file (mktemp).  
3. Loop over each target, export TARGET (and any other needed vars), and envsubst a corresponding template into the temp file.  
4. Execute the temp file with parallel -j 99 (or a user‑defined $PARALLEL_JOINS for joiner.sh).  
5. Cleanup – the temp file is automatically removed via trap.
Template Language
Templates are tiny shell snippets that reference ${TARGET} (and occasionally ${MODS} or ${THIS_CWD}).  
envsubst expands those variables before the command is executed on the remote host.
Examples:
* filecopierrr.tpl – copies a helper script:
    scp /root/filerrr.sh ${TARGET}:/root/filerrr.sh
  
* ping.tpl – reports host status:
    ssh ${TARGET} 'hostname && uptime && ip a'
  
Parallelism
- Default parallelism is -j 99, which spawns up to 99 concurrent jobs (adjustable by setting PARALLEL_JOINS in joiner.sh).  
- The high concurrency works well for small clusters; lower it if your control machine or network cannot sustain that many simultaneous SSH connections.
Configuration Files
registries.yaml
Used by up.sh to configure image registry mirrors for k3s.  
Typical content:
mirrors:
  docker.io:
    endpoint:
      - "https://registry-1.docker.io"
configs:
  "registry.example.com":
    auth:
      username: "myuser"
      password: "mypassword"
targets
Plain‑text list of every node that should receive the commands. No comments or empty lines.
Extending the Toolkit
Add a new operation by:
1. Creating a <name>.tpl that contains the remote command(s).  
2. Writing a wrapper script <name>.sh following the pattern used in the existing scripts (temp file, loop, envsubst, parallel).  
3. Optionally add a variable to the wrapper (e.g., PARALLEL_<NAME>) for custom concurrency.
License & Contribution
The repository is unlicensed (public domain) unless a LICENSE file is added later. Feel free to fork, modify, or submit pull requests.
Contact
For questions or contributions, open an issue or reach out to the repository owner.