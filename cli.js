#!/usr/bin/env node

const path = require('path');
const meow = require('meow');
const { DateTime } = require('luxon');
const previewEmail = require('preview-email');
const settings = require('./settings');
const log = require('./lib/log');
const writeFile = require('./lib/writeFile');
const sendEmail = require('./lib/sendEmail');
const sendEmailBatch = require('./lib/sendEmailBatch');
const createTaskReport = require('./lib/createTaskReport');
const jex = require('./services/jex');

// tasks
const olCourseConfirmRegistration = require('./tasks/olCourseConfirmRegistration');
const olCourseGetReady = require('./tasks/olCourseGetReady');
const olCourseOpen = require('./tasks/olCourseOpen');
const olWorkshopConfirmRegistration = require('./tasks/olWorkshopConfirmRegistration');
const remoteCourseGetReady = require('./tasks/remoteCourseGetReady');
const remoteCourseOpen = require('./tasks/remoteCourseOpen');
const ceCourseGetReady = require('./tasks/ceCourseGetReady');
const reportCartChecker = require('./tasks/reportCartChecker');

// Tasks
const validTasks = {
  'ce-course-get-ready': ceCourseGetReady,
  'ol-course-confirm-registration': olCourseConfirmRegistration,
  'ol-course-get-ready': olCourseGetReady,
  'ol-course-open': olCourseOpen,
  'ol-workshop-confirm-registration': olWorkshopConfirmRegistration,
  'remote-course-get-ready': remoteCourseGetReady,
  'remote-course-open': remoteCourseOpen,
  'report-cart-checker': reportCartChecker,
};

const isValidTask = (t) => !!validTasks[t];
const stringifyTasks = (tasks = validTasks) =>
  Object.keys(tasks)
    .map((t) => `\n\t    ${t}`)
    .join(' ');

const createLogSubject = ({ emails, errors, opts, taskName }) =>
  [
    `[${taskName}]`,
    errors.length ? `❌  ${errors.length} errors.` : '',
    emails.length ? `✉️  ${emails.length} emails.` : 'No emails.',
    emails.length && opts.send ? 'Sending.' : '',
    emails.length && !opts.send ? 'Generated, NOT sent.' : '',
  ].join(' ');

async function main() {
  const cli = meow(
    `
  Usage
    $ mcad-email-tasks <email-name> <options>

  Email Names ${stringifyTasks()}
  
  Options
    --today <ISO Date>     
        generate emails as if today was given date. If no date 
        is provided, current local date is used.
    --preview
        opens a preview of the email
    --send
        sends the email
    --email-log <email@address.com>
        sends the log to email address
    --help
        print this usage guide
  
  Examples
    $ mcad-email-tasks canvas-orientation --today 2019-01-15
`,
    {
      flags: {
        today: {
          type: 'string',
          default: DateTime.local().toISODate(),
        },
        preview: {
          type: 'boolean',
          default: false,
        },
        send: {
          type: 'boolean',
          default: false,
        },
        emailLog: {
          type: 'string',
        },
      },
    },
  );

  const taskChoice = cli.input[0];
  const { send, preview, emailLog } = cli.flags;

  let emails;
  let errors;
  let taskReport;

  // show help if not a valid task name
  if (!isValidTask(taskChoice)) {
    log(`Sorry "${taskChoice}" is not a valid task`);
    return cli.showHelp();
  }

  try {
    const taskFn = validTasks[taskChoice];

    // get the emails generated and any errors
    // that occured during generation
    ({ emails, errors } = await taskFn(cli.flags));
    jex.close();

    // create a report of how things went
    taskReport = createTaskReport({
      taskName: taskChoice,
      emails,
      errors,
      opts: cli.flags,
    });

    log(taskReport);

    // Handle output depending on options
    if (emails.length && send) {
      console.log(`sending ${emails.length} emails...`);
      const response = await sendEmailBatch(emails);
      console.log(response);
    }

    if (emails.length && preview) {
      previewEmail(emails[0]).then(log).catch(log);
    }

    if (emailLog) {
      const subject = createLogSubject({
        emails,
        errors,
        opts: cli.flags,
        taskName: taskChoice,
      });
      sendEmail({
        to: emailLog,
        from: settings.log.from,
        subject,
        text: taskReport,
      });
    }
  } catch (error) {
    log('❌  Error');
    log(error);
  }

  const timestamp = DateTime.local().toISO().replace(/[-:T]/g, '').replace(/\..+$/, '');

  const filename = `${taskChoice}-${timestamp}.log`;
  const fileDest = path.join(__dirname, './tmp', filename);
  log(`\n👍  Output: ${fileDest}`);
  await writeFile(fileDest, log().join('\n')).catch(console.error);

  return true;
}

// log unhandled rejections
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

main();
