# aws-dockerbalancer

Simple loadbalancer for managing a fixed pool of docker machines on AWS - relies on newrelic API

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
