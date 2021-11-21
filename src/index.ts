import Bull from 'bull';
import IORedis from 'ioredis';

const redisConnOpts: IORedis.RedisOptions = {
  port: 6379,
  host: 'localhost',
  keyPrefix: 'tf',
};

const jobOptions: Bull.JobOptions = {
  backoff: { type: 'fixed', delay: 2000 },
};

interface JobSpec {
    id: number;
    timeToSleep: number;
    name: string;
    bqTable: string;
    gcsKey: string;
    gcsToken: string;
}

const queue = new Bull<JobSpec>('jobs', { redis: redisConnOpts });

const attemptCount: Map<number, number> = new Map();

queue.process(2, async (job, done) => {
  console.log(`Processing job ${job.data.id}`);
  attemptCount.set(job.data.id, job.attemptsMade + 1);
  setTimeout(() => {
    if (attemptCount.get(job.data.id) !== job.data.timeToSleep) {
      done(new Error('not yet complete'));
    } else {
      done(null);
    }
  }, 1000);
});

queue.on('completed', async (job) => {
  console.log(`Completed job  ${job.data.id} ${job.data.timeToSleep}`);
});

queue.on('failed', async (job) => {
  console.log(`Job ${job.data.id} failed. Retrying...`);
  await job.retry();
});

// the part below is for testing the above code.
async function runJobs() {
  let jobsLeft = 10;
  return [...Array(jobsLeft).keys()].map(async (i) => {
    const spec :JobSpec = {
      id: i + 1,
      timeToSleep: i + 1,
      name: `job-${i}`,
      bqTable: 'optimizer',
      gcsKey: 'key',
      gcsToken: 'token',
    };
    const job = await queue.add(spec, jobOptions);
    attemptCount.set(job.data.id, 1);
    return job;
  }).map(async (jobPromise) => {
    const job = await jobPromise;
    const interval = setInterval(async () => {
      if (await job.isCompleted()) {
        clearInterval(interval);
        jobsLeft -= 1;
      }
      console.log(`Job status for ${job.data.id}. Attempts = ${job.attemptsMade}, ${attemptCount.get(job.data.id)}`);
      if (jobsLeft === 0) {
        process.exit(0)
      }
    }, 1000);
    return job;
  });
}

runJobs();
