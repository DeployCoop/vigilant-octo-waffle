# Roadmap

I am trying to make this more useful by variabilizing example.com so someone could conceivably use this on a k3s instance as something other than example.com possibly in production, but that is not recommended at this point in time.  At this point it is for running an example.com and related services on your local laptop to test things out.  K3D might be considered as well once the k3s stuff is worked out.

## Secrets

On the roadmap is a route to getting all secrets sync'd with openbao, and for all charts to use secrets instead of values in the values viles (typo but I'll keep it).  However, that ideally involves PRs upstream to the various charts repos themselves

# bash or sh or python?

Well it started out as `#!/bin/sh` but complications arose from dash being linked as sh on some systems, so I converted all shellscripts to `#!/usr/bin/env bash` to accomodate for weirdOS like NixOS.  Why not move all .sh scripts to be .bash? Why not convert them to python too?  We'll see.

# Style

So for the moment the style is decidedly bash with variables wrapped in curl brackets `${this_var}`, 
and with tests being in double brackets to avoid forking out to `test`, e.g.

```bash
if [[ ${this_var} -gt 99 ]]; then
  echo "greater than 99"
fi
```

And math in double parenthesis, e.g.

```bash
countzero=0
while [[ ${countzero} -lt 99 ]]; do
  echo "${countzero}"
  ((++countzero))
done
```

All execution should be at the base of this repo. 
i.e. All scripts etc should be put in the `src` directory and should be invoked like so:

```bash
src/argocd.sh
```

`cd` should be avoided, be sure to return to the root after you are done.

But I'm open to suggestions, and maybe converting many things to python or rust etc.
