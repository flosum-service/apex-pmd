
# ... via heroku button

<a href="https://heroku.com/deploy?template=https://github.com/FlosumHeokuConn/FlosumPMD">
  <img src="https://www.herokucdn.com/deploy/button.svg" alt="Deploy">
</a>


# ... via docker stack deploy or docker-compose

Example docker-compose.yml:

```yaml
version: '3.1'

services:
  apex-pmd:
    image: flosumhub/apex-pmd:2.7.2
    restart: always
    environment:
      password: xxxx
      username: xxxx
      
```

# Environment Variables
When you run the apex-pmd image, you need to configure it by passing environment variables on the docker run command line.
### username
The username entered on the Flosum side.

### password
The password entered on the Flosum side.

