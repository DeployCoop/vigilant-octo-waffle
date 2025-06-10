# Architecture

Envsubst is the simple templating method that I started this repo.  Most of the functionality in this repo comes from envsubst interpolating variables from .env into the various files in the argo and init directory.

### src

This was the original directory I started dumping scripts into.  Many of the projects have a named script in here, e.g. supabase.sh

Notable in here is:
#### [util.bash](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/util.bash) - 

This is the main library of functions, which includes `initializer`

Where you can see how I use envsubst to feed `kubectl apply -f -`:

```
    envsubst < ${f} | kubectl apply -f -
```

#### [argoRunner.sh](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/argoRunner.sh) -

This file is being used to unify the application scripts themselves where argo is also fed by envsubst:

```
envsubst < argo/${THIS_THING}/argocd.yaml | argocd app create --name ${THIS_THING} --grpc-web -f -
```

and in [src/bao.sh](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/bao.sh) you can see an example of how I am unifying the applications with the above shell scripts:

```
  initializer "${this_cwd}/init/bao"
  argoRunner "$THIS_THING"
```

### argo

This is a directory of argocd applications.  Each directoriy will be named after the intended application and will contain the yaml file for argo, and possibly a helm values file.

### init

This directory is for yaml that gets applied to the cluster, usually an ingress or something that was not included in the argo install.  There is a script `src/initializer.bash` that uses envsubst to apply the env vars and then apply them.
