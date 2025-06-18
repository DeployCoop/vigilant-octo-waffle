#!/usr/bin/env python
import os
import tempfile
import subprocess
from dotenv import dotenv_values
from pathlib import Path

with tempfile.TemporaryDirectory() as tmpdirname:
    print('created temporary directory', tmpdirname)

# convert my bash env vars to python
with tempfile.NamedTemporaryFile() as fp:
    print(f'src/printenv.sh > {fp.name}')
    myCompletedProcess = subprocess.run([f'src/printenv.sh > {fp.name}'], capture_output=True, shell=True)
    fp.seek(0)
    print(fp.read())
    config = {
        **dotenv_values(fp.name),  # load sensitive variables
        **os.environ,  # override loaded values with environment variables
    }
    fp.close()

print(config)
print(config['GOPATH'])
print("THIS_NAMESPACE =", config['THIS_NAMESPACE'])
print("THIS_NAMESPACE =", config['THIS_NAMESPACE'])
print("THIS_DOMAIN =", config['THIS_DOMAIN'])
print("THIS_NAMESPACE =", config['THIS_NAMESPACE'])
print("THIS_SECRETS =", config['THIS_SECRETS'])
print("KEY_FILE =", config['KEY_FILE'])
print("SECRET_FILE =", config['SECRET_FILE'])
print("THIS_ENABLE_PLAIN_SECRETS_FILE =", config['THIS_ENABLE_PLAIN_SECRETS_FILE'])
print("THIS_OUT_SMTP_EMAIL =", config['THIS_OUT_SMTP_EMAIL'])
