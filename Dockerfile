FROM node:22 AS build

WORKDIR /app
COPY package.json yarn.lock ./

RUN yarn install

COPY . .

RUN yarn build


FROM nginx:alpine AS production
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
