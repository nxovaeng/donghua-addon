FROM node:20-alpine AS builder

WORKDIR /app

# 1. 复制依赖描述文件并安装
COPY package*.json ./
RUN npm install

# 2. 复制全部源代码并进行构建（编译 TypeScript 等）
COPY . .
RUN npm run build

# 3. 生产环境基础镜像
FROM node:20-alpine

WORKDIR /app

# 4. 只安装生产环境所需的依赖，减小镜像体积
COPY package*.json ./
RUN npm install --omit=dev

# 5. 从构建阶段拷贝编译好的文件
COPY --from=builder /app/dist ./dist

# 切换到非 root 用户运行，提升安全性
USER node

# 声明对外暴露的端口
EXPOSE 3000

# 启动命令
CMD ["npm", "start"]
