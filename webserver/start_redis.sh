docker run -p 6379:6379 -v $PWD/redis_data/:/data --name redis -d redis redis-server --appendonly yes

