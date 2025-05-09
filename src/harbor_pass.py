from hashlib import pbkdf2_hmac

salt = "z7x9U6Zk7o9DiF2MQzD3nRdDhgDo4F4c"
plain_text_password = "newharbor123"

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
    f"update harbor_user set salt='{salt}', password='{hash.hex()}' where user_id = 1;"
)
