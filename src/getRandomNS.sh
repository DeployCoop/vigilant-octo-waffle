#!/usr/bin/env bash
cat nameservers.csv |cut -f1 -d,|shuf|tail -n10|sed 's!^\(.*\)!--forwarder=\1 \\!'
