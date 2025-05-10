#!/usr/bin/env python
# Python program to demonstrate
# command line arguments
import sys
import random
argumentList = sys.argv[1:]
if len(argumentList) == 1:
    #print(argumentList)
    #salt = "z7x9U6Zk7o9DiF2MQzD3nRdDhgDo4F4c"
    ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    chars=[]
    for i in range(31):
        chars.append(random.choice(ALPHABET))
    salt="".join(chars)
    plain_text_password = argumentList[0]
    #print(plain_text_password)
elif len(argumentList) == 2:
    plain_text_password = argumentList[0]
    salt = argumentList[1]
    #print(plain_text_password)
    #print(salt)
else:
    print("useage: ", sys.argv[0], " password")
    exit(1)



from hashlib import pbkdf2_hmac


# plain_text_password "plain text password"
# salt "salt field in database"
# password "password field in database"
# hash_name "password_version field in database"
# iterations "fixed value 4096 in code"
# dklen "fixed value 16 in code"
# https://github.com/goharbor/harbor/blob/release-2.11.0/src/common/utils/encrypt.go#L49
hash = pbkdf2_hmac(
    hash_name="sha256",
    password=plain_text_password.encode("utf-8"),
    salt=salt.encode("utf-8"),
    iterations=4096,
    dklen=16,
)
print(
    #f"/usr/bin/psql -d \\'registry\\' -c \\\"update harbor_user set salt=\\'{salt}\\', password=\\'{hash.hex()}\\' where user_id = 1;\\\""
    f"/usr/bin/psql -d 'registry' -c \"update harbor_user set salt='{salt}', password='{hash.hex()}' where user_id = 1;\""
    #f"echo \"update harbor_user set salt='{salt}', password='{hash.hex()}' where user_id = 1;\""
)
