#!/usr/bin/env python
import bcrypt
import sys
argumentList = sys.argv[1:]
if len(argumentList) == 1:
    plain_text_password = argumentList[0]
    print(bcrypt.hashpw(plain_text_password.encode("utf-8"), bcrypt.gensalt(12, prefix=b"2a")).decode("utf-8"))
else:
    print("useage: ", sys.argv[0], " password")
    exit(1)
