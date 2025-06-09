default: .env .env.enabler

.env:
	cp -iv src/default.env .env

.env.enabler:
	cp -iv src/example.env.enabler .env.enabler
