# aws-dockerbalancer

Simple loadbalancer for managing a fixed pool of docker machines on AWS - relies on newrelic API

Why ? 

AWS relies on lazy-loading when it comes to spin off new instances of EC2 machines in an Elastic Load Balancer system. When you're using docker hosts, there is substantial data on 
the system disk that make the newly started instances unresponsive for several minutes (because Docker need to load and start all its stuff BEFORE 
it can launch your beloved and beautifully crafted code). What's the point of using a loadbalancer if you have 10 minutes of "loading" after instance start ? You need it now.

That's why we imagined a system using several preconfigured docker hosts, arranged in a pool, and started/stopped/added/removed from ELB on demand. Based on newrelic 
to "sniff" your app needs on the fly and configuring the right amount of nodes accordingly.

ENV vars :
NEWRELIC_APIKEY : API key, found in newrelic settings
NEWRELIC_APPID : Id of newrelic application
AWS_ACCESS_KEY_ID : AWS access key of the user to impersonate (give him AmazonEC2FullAccess on IAM)
AWS_SECRET_ACCESS_KEY : AWS secret key of the user to impersonate
AWS_REGION : ex. eu-west-1
AWS_AUTOSCALING_GROUP_NAME : Auto scaling group we'll add or remove instances from

MIN_APDEX=0.90 : Minimum average apdex

UPSCALE_RPM=1400 : Upscale if rpm > ?

DOWNSCALE_RPM=1000 : Downscale if rpm < ?

SCALE_UP_BY=2 : Start x instances at at time

SCALE_DOWN_BY=1 : Stop x instances at a time

CHECK_EVERY=10000 : Polling frequency (1000 = 1 sec)

MIN_INSTANCES=2 : X instances to keep in ASG

MAX_INSTANCES=11 : X instances max in the ASG

TAG_INSTANCES=Test : Available instances must have this Group:X tag

You'll also need a newrelic.js file containing your app_name and credentials onto newrelic. See their node.js documentation
