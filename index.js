const http = require('http');
const AWS = require('aws-sdk');
const request = require('request');
const newrelic = ('newrelic');
const moment = require('moment');
const airbrake = require('airbrake').createClient("127084", "442916645e277071f16093c99e880a72");
airbrake.handleExceptions();

let nextIteration = null;
let debug_mode = false;

// Configure our HTTP server to respond with Hello World to all requests.
const server = http.createServer((request, response) => {

  if (request.method === 'GET' && request.url === '/boost') {
    response.writeHead(200, {"Content-Type": "text/plain"});
    boost(response);
  } else {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.write(`${aws_running_instances.length} running & ${aws_stopped_instances.length} stopped\n`);
    response.write(`last apdex : ${nr_apdex_value}\n`);
    response.write(`last rpm/instance : ${nr_rpm_value}\n`);
    response.end((nextIteration!=null) ? "Up and running !\n" : "KO");
  }


  //console.log('Got connection');
});

// Listen on port 8000, IP defaults to 127.0.0.1
server.listen(8000);

// Put a friendly message on the terminal
console.log(`Newrelic APIKEY : ${process.env.NEWRELIC_APIKEY}`);
console.log(`Newrelic APPID : ${process.env.NEWRELIC_APPID}`);

//NEW RELIC
const nr_apikey = process.env.NEWRELIC_APIKEY;
const nr_appid = process.env.NEWRELIC_APPID;
const nr_apdex_url = `https://api.newrelic.com/v2/applications/${nr_appid}/metrics/data.json?names[]=Apdex&values[]=value&period=60`;
const nr_rpm_url = `https://api.newrelic.com/v2/applications/${nr_appid}/metrics/data.json?names[]=HttpDispatcher&values[]=requests_per_minute&period=60`;
let nr_apdex_value = 1;
let nr_rpm_value = 0;

//AWS
const auto_scaling_group_name = process.env.AWS_AUTOSCALING_GROUP_NAME;
let aws_running_instances = [];
let aws_stopped_instances = [];

//Thresholds
const check_every = process.env.CHECK_EVERY;
const upscale_rpm = parseInt(process.env.UPSCALE_RPM,10);
const downscale_rpm = parseInt(process.env.DOWNSCALE_RPM,10);
const min_apdex = parseFloat(process.env.MIN_APDEX);
const min_instances = parseInt(process.env.MIN_INSTANCES,10);
const max_instances = parseInt(process.env.MAX_INSTANCES,10);
const tag_instances = process.env.TAG_INSTANCES;
const scale_up_by = parseInt(process.env.SCALE_UP_BY,10);
const scale_down_by = parseInt(process.env.SCALE_DOWN_BY,10);

//loop(); //Start event loop
setNextIteration();

//Start all instances
function boost(response) {
  get_aws_instances(function () {
    //console.log(aws_stopped_instances);
    if (aws_stopped_instances.length > 0) {
      clearInterval(nextIteration);
      start_and_attach(aws_stopped_instances.map(a => a.InstanceId), function () {
        setNextIteration(1000 * 60 * 55); // 55 minutes

        console.log('-----------------------------BOOST MODE---------------------------------')

        //Report an incomplete instances count
        if ((aws_stopped_instances.length + aws_running_instances.length) != max_instances) {
          response.write('incomplete ');
        }
        response.write(aws_running_instances.map(a => a.KeyName).join(' '));
        response.write(' ');
        response.end(aws_stopped_instances.map(a => a.KeyName).join(' '));
      });
    }
    else {
      response.end('full');
    }
  });
}


function loop() {
  //clearInterval(nextIteration);
  //nextIteration = null;
  console.log(`---------------------------------------------------------------`);
  get_aws_instances(function () {
    get_newrelic_values(function () {
      if(nr_apdex_value>min_apdex && nr_rpm_value>downscale_rpm && nr_rpm_value<upscale_rpm) {
        // All good ! See ya next time
        setNextIteration();
        return;
      }

      if (nr_apdex_value < min_apdex || nr_rpm_value > upscale_rpm) {

        let up = get_possible_upscale();
        console.log(`Upscale ${up}`);
        if (up > 0) {
          //console.log(aws_running_instances);
          //console.log(aws_running_instances.sort((a, b) => moment(a.LaunchTime) > moment(b.LaunchTime))[0]);

          start_and_attach(aws_stopped_instances.slice(0, up).map(a => a.InstanceId), function () {
            setNextIteration(check_every*2);
          });
        }
        else {
          console.log(`No more free instances. Consider add new instances to Group:${tag_instances}`);
          setNextIteration();
        }
        return;
      }

      if(nr_apdex_value>min_apdex && nr_rpm_value<downscale_rpm) {

        let down = get_possible_downscale();
        console.log(`Downscale ${down}`);
        if (down > 0) {
          //console.log(aws_running_instances);
          console.log(aws_running_instances.sort((a, b) => moment(a.LaunchTime) > moment(b.LaunchTime)).slice(0, down).map(a => a.LaunchTime));

          //aws_running_instances.sort((a, b) => a.last_nom > b.last_nom);
          stop_and_detach(aws_running_instances.sort((a, b) => moment(a.LaunchTime) > moment(b.LaunchTime)).slice(0, down).map(a => a.InstanceId), function () {
            setNextIteration();
          });
        }
        else {
          console.log(`Cannot scale down under ${min_instances}. If it happens too frequently, consider lowering MIN_INSTANCES.`);
          setNextIteration();
        }

        return;
      }
    });
  });
}

function setNextIteration(specific=0) {
  //LB Loop
  clearInterval(nextIteration);
  nextIteration = setInterval(() => {
    loop();
  }, specific==0 ? check_every : specific);
}

function get_possible_upscale() {
  if ((aws_running_instances.length + scale_up_by) <= max_instances) {
    return scale_up_by;
  }
  else {
    return max_instances - aws_running_instances.length;
  }
}

function get_possible_downscale() {
  if ((aws_running_instances.length - scale_down_by) >= min_instances) {
    return scale_down_by;
  }
  else {
    return aws_running_instances.length - min_instances;
  }
}

function get_newrelic_values(todo = function () { }) {
  get_current_apdex(function () {
    get_current_rpm(todo);
  });
}

function get_current_apdex(todo= function () { }){

  //GET current apdex
  let options = {
    url: nr_apdex_url,
    headers: {
      'X-Api-Key': nr_apikey
    }
  };
  request(options, (error, response, body) => {
      if (!error && response.statusCode == 200) {
        nr_apdex_value = JSON.parse(body).metric_data.metrics[0].timeslices.slice(-1)[0].values.value
        console.log(`Apdex : ${nr_apdex_value}`)
        todo();
      }
  })
}

function get_current_rpm(todo = function () { }){
  //GET current rpm
  options = {
    url: nr_rpm_url,
    headers: {
      'X-Api-Key': nr_apikey
    }
  };
  request(options, (error, response, body) => {
      if (!error && response.statusCode == 200) {
        //Ignore sleeping instances (admin/background workers)

        let anteante = JSON.parse(body).metric_data.metrics[0].timeslices.slice(-3, -2)[0].values.requests_per_minute;
        let ante = JSON.parse(body).metric_data.metrics[0].timeslices.slice(-2, -1)[0].values.requests_per_minute;
        let last = JSON.parse(body).metric_data.metrics[0].timeslices.slice(-1)[0].values.requests_per_minute;
        let value_to_test = Math.floor((anteante + ante + last)/3);

        console.log(`Rpm global : ${value_to_test}`);
        nr_rpm_value = Math.floor((value_to_test / aws_running_instances.length));
        console.log(`Rpm/${aws_running_instances.length} instances : ${nr_rpm_value}`)
        todo();
      }
  })
}

function start_and_attach(instanceIds, todo = function () { }) {
  if (instanceIds.length == 0) { console.log(`Not enough available instances. Consider lowering MAX_INSTANCES to match.`); todo(); return;}
  start_instances(instanceIds, function () {
    console.log(`started`)
    attach_instances(instanceIds, function () {
      console.log(`attached`);
      todo();
    })
  });
}

function stop_and_detach(instanceIds, todo = function () { }) {
  if (instanceIds.length == 0) { console.log(`No instance to stop.`); todo(); return;}
  detach_instances(instanceIds, function () {
    console.log(`detached`);
    stop_instances(instanceIds, function () {
      console.log(`stopped`);
      todo();
    })
  });
}

function attach_instances(instanceIds, todo = function () { }) {
  console.log(`Attach initiating : ${instanceIds}`);
  let autoscaling = new AWS.AutoScaling();
  let params = {
    AutoScalingGroupName: auto_scaling_group_name, /* required */
    InstanceIds: instanceIds
  };
  autoscaling.attachInstances(params, function(err, data) {
    if (err) {
      console.log(`Attach failed : ${instanceIds}`);
      console.log(err, err.stack);
      todo();
    }
    else {
      //console.log(data);
      todo();
    }
  });
}

function start_instances(instanceIds, todo = function () { }) {
  console.log(`Start initiating : ${instanceIds}`);
  let ec2 = new AWS.EC2();
  var params = {
    InstanceIds: instanceIds,
    DryRun: false
  };
  ec2.startInstances(params, function(err, data) {
    if (err) {
      console.log(`Start failed : ${instanceIds}`);
      console.log(err, err.stack);
      todo();
    }
    else {
      let params = {
        InstanceIds: instanceIds,
        DryRun: false
      };
      ec2.waitFor('instanceRunning', params, function (err, data) {
        if (err) {
          console.log(err, err.stack);
          todo();
        }
        else { todo(); }
      });
    }
  });
}

function detach_instances(instanceIds, todo = function () { }) {
  console.log(`Detach initiating : ${instanceIds}`);
  let autoscaling = new AWS.AutoScaling();
  let params = {
    AutoScalingGroupName: auto_scaling_group_name, /* required */
    InstanceIds: instanceIds,
    ShouldDecrementDesiredCapacity: true
  };
  autoscaling.detachInstances(params, function(err, data) {
    if (err) {
      console.log(`Detach failed : ${instanceIds}`);
      console.log(err, err.stack);
      todo();
    }
    else {
      //console.log(data);
      todo();
    }
  });
}

function stop_instances(instanceIds, todo = function () { }) {
  console.log(`Stop initiating : ${instanceIds}`);
  let ec2 = new AWS.EC2();
  let params = {
    InstanceIds: instanceIds,
    DryRun: false
  };
  ec2.stopInstances(params, function(err, data) {
    if (err) {
      console.log(`Stop failed : ${instanceIds}`);
      console.log(err, err.stack);
    }
    else {
      //console.log(data);
      todo();
    }
  });
}

function get_aws_instances(todo = function () { }){
  let ec2 = new AWS.EC2();
  let params = {
    DryRun: false,
    Filters: [
      {
        Name: 'tag:Group',
        Values: [
          tag_instances
        ]
      }
    ]
  };
  ec2.describeInstances(params, function(err, data) {
    if (err) {
      console.log(err, err.stack);

    }
    else {
      //console.log(data.Reservations[0].Instances[0]);
      aws_running_instances = [];
      aws_stopped_instances = [];
      data.Reservations.forEach(function (resa) {
        resa.Instances.forEach(function (instance) {
          if (instance.State.Name==='running'){
            aws_running_instances.push(instance)
          }
          if (instance.State.Name==='stopped'){
            aws_stopped_instances.push(instance)
          }
        });
      });
      console.log(`Found ${aws_running_instances.length} runnning and ${aws_stopped_instances.length} stopped instances`);
      todo();
    }
  });
}