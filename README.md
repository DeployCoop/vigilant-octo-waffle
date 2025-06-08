# vigilant-octo-waffle
![Vigilant Octo Waffle](src/vigilantoctowaffle.png?raw=true "Title")

This is a repo builds a kubernetes cluster in KinD or K3S, and then templatizes the necessary yaml to apply the [urban-disco](https://github.com/DeployCoop/urban-disco) as argoCD applications.  

You can use this repo to spin up a domain of your choice and a bunch of related services in KinD (kubernetes in docker).

It's main use is so I can replicate issues I'm having on internal infrastructure and use this an example when requesting support through github issues and that sort of thing.

Maybe the coolest part is that I got [mkcert](https://mkcert.org) working and installed the certs so that https://example.com and many other hostnames pass the TLS checks in the browser.
So I can verify that everything is done securely even in my examples.

### Requirements

bash  # much of this was written in bash

python # there is at least one python script in here for now to update the password for harbor

kubectl

argocd

tr

pwgen

openssl

[mkcert](https://mkcert.org)

[KinD](https://kind.sigs.k8s.io)

### Configuration 

`make .env`

And edit that file and it should be working

There is also a convenience script to populate your local hosts file:

`src/hostr.sh`

### [mkcert](https://mkcert.org)

Install [mkcert](https://mkcert.org) and ensure it is in your path and then:

`mkcert -install`

And your browser should then accept the certs from certificate-manager within KinD.  The configuration of KinD and certificate-manager are completely automated from here on out.

For further help on [mkcert](https://mkcert.org), check their [github](https://github.com/Lukasa/mkcert).

### Useage

To start the cluster:

`./up.sh`

for now and you should have a cluster like so:

```bash
urban-disco on  main on ☁️   (us-east-2) on ☁️    
󰰸 ❯ kgia
NAMESPACE   NAME                             CLASS   HOSTS                  ADDRESS   PORTS     AGE
argocd      argocd-server-ingress            nginx   argocd.example.com               80, 443   4h28m
example     goharbor-example-ingress         nginx   harbor.example.com               80, 443   4h27m
example     keycloak                         nginx   keycloak.example.com             80, 443   4h28m
example     openbao                          nginx   bao.example.com                  80, 443   4h27m
example     openbao-ui                       nginx   baoui.example.com                80, 443   4h27m
example     supabase-example-supabase-kong   nginx   supa.example.com                 80, 443   4h27m
urban-disco on  main on ☁️   (us-east-2) on ☁️    
󰰸 ❯ k get cert -A
NAMESPACE   NAME                          READY   SECRET                        AGE
argocd      argocd-example-tls            True    argocd-example-tls            4h28m
example     chart-bao-example.com-tls     True    chart-bao-example.com-tls     4h27m
example     chart-example-baoui-tls       True    chart-example-baoui-tls       4h27m
example     chart-example-keycloak-tls    True    chart-example-keycloak-tls    4h28m
example     harborishel1234018730248971   True    harborishel1234018730248971   4h27m
example     supatekro-ingress-tls         True    supatekro-ingress-tls         4h27m
```

### Deplying to the local harbor registry:

Start in https://harbor.example.com/ and make a new user and a project to push into.

Add that user to the project, and then login using

```bash
docker login harbor.example.com
```

And then push into it:

```bash
docker push harbor.example.com/demo/mydockerthing:latest
```

# Down

To tear it all down:

```bash
kindDown.sh
```

# Enabler

You can make the default `.env.enabler` file with:

```
make .env.enabler
```

Then simply delete any service you don't want to start from that file, or change its value into anything other than true.

# Architecture

Envsubst is the simple templating method that I started this repo.  Most of the functionality in this repo comes from envsubst interpolating variables from .env into the various files in the argo and init directory.

### src

This was the original directory I started dumping scripts into.  Many of the projects have a named script in here, e.g. supabase.sh

Notable in here is:
#### [initializer.bash](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/initializer.bash) - 

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

# Contributing

The easiest way to contribute is to add more applications.  Here are the steps to add another helm chart.

1. Fetch and untar a chart e.g. `helm fetch --repo https://jp-gouin.github.io/helm-openldap/ openldap --untar`
1. Add the chart to [urban-disco](https://github.com/DeployCoop/urban-disco) or your own chart repo.
1. Create a directory with your apps name in the `argo` directory.  Take the values.yaml and place it here. e.g. [argo/bao](https://github.com/DeployCoop/vigilant-octo-waffle/tree/main/argo/bao)
1. Take the values.yaml from your chart and place it in the `argo/YOURAPP` directory. e.g. bao [argo/bao/values.yaml](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/argo/bao/values.yaml)
1. Add the argo yaml file `argocd.yaml`in the `argo/YOURAPP` directory. e.g. [argo/bao/argocd.yaml](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/argo/bao/argocd.yaml)
1. Add any more yaml like ingresses to the `init/YOURAPP` directory. e.g. [init/argo](https://github.com/DeployCoop/vigilant-octo-waffle/tree/main/init/bao)
1. Add host for your application to [src/hosts](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/hosts).
1. Add env vars to [example.env](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/example.env).
1. Add YOURAPP_ENABLED=true to [example.env.enabler](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/example.env.enabler) must match ${THIS_THING}_ENABLED as set in the `src/YOUR_APP.sh` script and you must convert all lower to upper case and replace all dashes with underscores and 
1. Create a script in `src` that installs your application. e.g. [src/bao.sh](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/bao.sh)
1. Add this script to [src/big_list](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/big_list)

# Roadmap

I am trying to make this more useful by variabilizing example.com so someone could conceivably use this on a k3s instance as something other than example.com possibly in production, but that is not recommended at this point in time.  At this point it is for running an example.com and related services on your local laptop to test things out.  K3D might be considered as well once the k3s stuff is worked out.

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

But I'm open to suggestions, and maybe converting many things to python or rust etc.
