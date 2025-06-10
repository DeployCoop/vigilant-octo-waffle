# Contributing

## Adding applications

Perhaps the easiest way to contribute is to add more applications.  

Here are the steps to add another helm chart:

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

## Updating charts in the urban-disco repo

I usually just delete the chart and `helm fetch --untar` it again, 
and then do `git diff` to study mainly the differences in the values.yaml file
to see if the structure has changed and values need to be updated or moved, 
for example an ingress might be moved to a subordinate service:

```yaml
ingress:
  enabled: false
  className: nginx
```

to:

```yaml
web:
  ingress:
    enabled: false
    className: nginx
```

Then those values must be updated in the `argo` directory as well.
