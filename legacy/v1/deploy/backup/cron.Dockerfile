FROM alpine:3.20

RUN apk add --no-cache bash docker-cli docker-cli-compose

CMD ["crond", "-f", "-l", "8"]
