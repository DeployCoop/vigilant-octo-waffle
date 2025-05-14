# vigilant-octo-waffle

This is a repo that templatizes the necessary yaml to apply to the [urban-disco](https://github.com/DeployCoop/urban-disco).  Which is a collection of helm charts.

You can use this repo to spin up example.com and a bunch of related services in KinD (kubernetes in docker).

It's main use is so i can replicate issues I'm having on internal infrastructure and use as an example when requesting support through github issues and that sort of thing.

Maybe the coolest part is that I got mkcert and installed the certs so that https://example.com and many other hostnames pass the TLS checks in the browser.

So I can verify that everything is done securely even in my examples.

### Configuration 

`make .env`

And edit that file and it should be working

There is also a convenience script to populate your local hosts file:

`src/hostr.sh`

### Useage

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
