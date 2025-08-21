#!/usr/bin/env bash

#TARGETS=$(argocd app list|grep -v '^NAME'|awk '{print $1}'|cut -f2 -d'/'|sed 's/^/argocd app delete /')
TARGETS=$(argocd app list|grep -v '^NAME'|awk '{print $1}'|cut -f2 -d'/')

for i in $TARGETS; do
  argocd app delete -y $i
done

