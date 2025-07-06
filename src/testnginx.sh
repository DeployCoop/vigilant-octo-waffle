#!/usr/bin/env bash
kubectl create deployment nginx --image nginx:alpine 
kubectl expose deployment nginx --port 80 --target-port 80
