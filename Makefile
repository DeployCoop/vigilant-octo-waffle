default: .env .env.enabler

.env:
	cp -iv example.env .env

.env.enabler:
	cp -iv example.env.enabler .env.enabler
