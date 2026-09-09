/**
 * A 200-tool catalog, and the tasks that have to find their way through it.
 *
 * ## Why this catalog is synthetic, and what is still real about it
 *
 * Nobody ships a public 200-tool JSON dump you can clone. What people *do* ship is
 * ten or twenty MCP servers connected at once, each contributing five to fifteen
 * tools, and that is what this file imitates: 20 services x 10 operations.
 *
 * The catalog is invented. Three things measured on top of it are not:
 *
 *   1. the serialised size of the tool list (bytes are bytes)
 *   2. whether BM25 puts the right tool in the top 5 (deterministic, `demo.ts`)
 *   3. which tool a real model actually calls (`agent.ts`, real API, real usage)
 *
 * ## The one property that makes it a fair test
 *
 * Real catalogs are full of **near-duplicates**, because different vendors solve
 * the same problem. This one has, on purpose:
 *
 *   - four ways to file a bug   (github / gitlab / jira / linear + sentry's own)
 *   - five ways to send a message (slack / discord / sendgrid / twilio / pagerduty)
 *   - three ways to run a query  (postgres / snowflake / datadog)
 *
 * A catalog of 200 *distinct* tools would be an easy problem. The reason 200 tools
 * hurt is not the count; it is that fifteen of them are a plausible answer to
 * "notify someone".
 */

import type { ToolSpec } from "../shared/providers/types.ts";

export interface CatalogTool extends ToolSpec {
	/** Which service contributed it. Not sent to the model; used for reporting. */
	service: string;
}

/**
 * `name, description, params`.
 *
 * `params` is a shorthand — `field:type` and `!` for required — expanded into JSON
 * Schema below. Written this way so 200 tools stay readable as a table; a real
 * catalog arrives as JSON Schema already and you never type it.
 */
type Entry = [op: string, description: string, params: string];

const SERVICES: Record<string, Entry[]> = {
	github: [
		["create_issue", "Open a new issue in a GitHub repository.", "repo:string!,title:string!,body:string,labels:array"],
		["close_issue", "Close an open GitHub issue.", "repo:string!,issue_number:number!,reason:string"],
		["create_pull_request", "Open a pull request from one branch into another.", "repo:string!,head:string!,base:string!,title:string!"],
		["merge_pull_request", "Merge an approved pull request.", "repo:string!,pull_number:number!,method:string"],
		["list_commits", "List commits on a branch, newest first.", "repo:string!,branch:string,since:string"],
		["create_release", "Cut a tagged GitHub release with notes.", "repo:string!,tag:string!,notes:string"],
		["update_branch_protection", "Change branch protection rules: required reviews, status checks, who may push directly.", "repo:string!,branch:string!,required_reviews:number,allow_force_push:boolean"],
		["add_collaborator", "Grant a user push access to a repository.", "repo:string!,username:string!,permission:string"],
		["dispatch_workflow", "Manually trigger a GitHub Actions workflow run.", "repo:string!,workflow:string!,ref:string"],
		["search_code", "Search source code across repositories.", "query:string!,repo:string,language:string"],
	],
	gitlab: [
		["create_issue", "Open a new issue in a GitLab project.", "project:string!,title:string!,description:string"],
		["create_merge_request", "Open a merge request between two branches.", "project:string!,source:string!,target:string!,title:string!"],
		["merge_merge_request", "Merge an approved merge request.", "project:string!,mr_iid:number!"],
		["list_pipelines", "List recent CI pipelines and their status.", "project:string!,ref:string,status:string"],
		["retry_pipeline", "Retry a failed CI pipeline.", "project:string!,pipeline_id:number!"],
		["create_tag", "Create a git tag on a project.", "project:string!,tag:string!,ref:string!"],
		["protect_branch", "Protect a branch against direct pushes.", "project:string!,branch:string!,push_level:string"],
		["add_member", "Add a member to a GitLab project.", "project:string!,username:string!,access_level:string"],
		["list_commits", "List commits on a GitLab branch.", "project:string!,ref:string"],
		["search_projects", "Search GitLab projects by name.", "query:string!"],
	],
	slack: [
		["send_message", "Post a message into a Slack channel or DM.", "channel:string!,text:string!,thread_ts:string"],
		["update_message", "Edit a Slack message that was already posted.", "channel:string!,ts:string!,text:string!"],
		["create_channel", "Create a new Slack channel.", "name:string!,private:boolean"],
		["archive_channel", "Archive a Slack channel nobody uses any more.", "channel:string!"],
		["invite_user", "Invite a user into a Slack channel.", "channel:string!,user:string!"],
		["upload_file", "Upload a file or snippet into a Slack channel.", "channel:string!,filename:string!,content:string!"],
		["add_reaction", "Add an emoji reaction to a Slack message.", "channel:string!,ts:string!,emoji:string!"],
		["list_channels", "List Slack channels in the workspace.", "types:string,limit:number"],
		["search_messages", "Search Slack message history.", "query:string!,channel:string"],
		["set_topic", "Set a Slack channel's topic line.", "channel:string!,topic:string!"],
	],
	discord: [
		["send_message", "Post a message into a Discord channel.", "channel_id:string!,content:string!"],
		["create_channel", "Create a channel in a Discord guild.", "guild_id:string!,name:string!,type:string"],
		["delete_message", "Delete a message from a Discord channel.", "channel_id:string!,message_id:string!"],
		["ban_member", "Ban a member from a Discord guild.", "guild_id:string!,user_id:string!,reason:string"],
		["create_invite", "Create an invite link to a Discord channel.", "channel_id:string!,max_age:number"],
		["add_role", "Give a Discord member a role.", "guild_id:string!,user_id:string!,role_id:string!"],
		["list_members", "List members of a Discord guild.", "guild_id:string!,limit:number"],
		["pin_message", "Pin a message in a Discord channel.", "channel_id:string!,message_id:string!"],
		["create_thread", "Start a thread from a Discord message.", "channel_id:string!,message_id:string!,name:string!"],
		["set_nickname", "Change a member's nickname in a Discord guild.", "guild_id:string!,user_id:string!,nick:string!"],
	],
	jira: [
		["create_issue", "Create a Jira issue in a project.", "project:string!,summary:string!,type:string!,description:string"],
		["transition_issue", "Move a Jira issue to another workflow status.", "issue_key:string!,status:string!"],
		["assign_issue", "Assign a Jira issue to a user.", "issue_key:string!,assignee:string!"],
		["add_comment", "Add a comment to a Jira issue.", "issue_key:string!,body:string!"],
		["create_sprint", "Create a sprint on a Jira board.", "board_id:number!,name:string!,start:string,end:string"],
		["list_issues", "List Jira issues in a project or sprint.", "project:string,sprint_id:number,status:string"],
		["link_issues", "Link two Jira issues (blocks, duplicates, relates to).", "from_key:string!,to_key:string!,link_type:string!"],
		["log_work", "Log time spent against a Jira issue.", "issue_key:string!,time_spent:string!,comment:string"],
		["create_version", "Create a release version in a Jira project.", "project:string!,name:string!,release_date:string"],
		["search_jql", "Search Jira issues with a JQL query.", "jql:string!,max_results:number"],
	],
	linear: [
		["create_issue", "Create an issue on a Linear team's board so it shows up in the sprint.", "team:string!,title:string!,description:string,priority:number"],
		["update_issue", "Update a Linear issue's title, description or state.", "issue_id:string!,title:string,state:string"],
		["assign_issue", "Assign a Linear issue to a team member.", "issue_id:string!,assignee:string!"],
		["create_project", "Create a Linear project to group issues.", "team:string!,name:string!,target_date:string"],
		["list_issues", "List Linear issues for a team, cycle or assignee.", "team:string,cycle_id:string,assignee:string"],
		["add_comment", "Comment on a Linear issue.", "issue_id:string!,body:string!"],
		["create_cycle", "Create a Linear cycle (the two-week iteration).", "team:string!,name:string!,starts_at:string!"],
		["archive_issue", "Archive a Linear issue that will not be done.", "issue_id:string!"],
		["search_issues", "Search Linear issues by text.", "query:string!,team:string"],
		["set_priority", "Change a Linear issue's priority.", "issue_id:string!,priority:number!"],
	],
	notion: [
		["create_page", "Create a Notion page under a parent page or database, with body content.", "parent_id:string!,title:string!,content:string"],
		["update_page", "Update a Notion page's properties.", "page_id:string!,properties:object!"],
		["append_block", "Append blocks to the end of a Notion page.", "page_id:string!,content:string!"],
		["create_database", "Create a Notion database with a schema.", "parent_id:string!,title:string!,schema:object!"],
		["query_database", "Query a Notion database with filters and sorts.", "database_id:string!,filter:object,sorts:array"],
		["search", "Search Notion pages and databases by title.", "query:string!"],
		["delete_block", "Delete a block from a Notion page.", "block_id:string!"],
		["add_comment", "Add a comment to a Notion page.", "page_id:string!,text:string!"],
		["list_users", "List users in the Notion workspace.", "limit:number"],
		["duplicate_page", "Duplicate an existing Notion page.", "page_id:string!,parent_id:string"],
	],
	stripe: [
		["create_charge", "Charge a customer's saved payment method.", "customer:string!,amount:number!,currency:string!"],
		["create_refund", "Refund a payment back to the customer, in full or in part.", "charge_id:string!,amount:number,reason:string"],
		["create_customer", "Create a Stripe customer record.", "email:string!,name:string"],
		["create_subscription", "Start a recurring subscription for a customer.", "customer:string!,price:string!"],
		["cancel_subscription", "Cancel a customer's subscription.", "subscription:string!,at_period_end:boolean"],
		["list_invoices", "List invoices for a customer.", "customer:string,status:string,limit:number"],
		["send_invoice", "Email an unpaid invoice to the customer.", "invoice:string!"],
		["create_payment_link", "Create a shareable payment link.", "price:string!,quantity:number"],
		["list_disputes", "List chargeback disputes.", "status:string,limit:number"],
		["update_customer", "Update a Stripe customer's details.", "customer:string!,email:string,name:string"],
	],
	shopify: [
		["create_order", "Create a draft order in the store.", "customer_id:string!,line_items:array!"],
		["cancel_order", "Cancel a store order.", "order_id:string!,reason:string"],
		["fulfill_order", "Mark an order fulfilled and attach tracking.", "order_id:string!,tracking_number:string"],
		["create_product", "Create a product listing.", "title:string!,price:number!,inventory:number"],
		["update_inventory", "Adjust the stock level of a variant.", "variant_id:string!,quantity:number!"],
		["list_orders", "List store orders by status or date.", "status:string,since:string"],
		["create_discount", "Create a discount code.", "code:string!,percent_off:number!"],
		["refund_order", "Refund a store order.", "order_id:string!,amount:number"],
		["list_customers", "List store customers.", "query:string,limit:number"],
		["update_product", "Update a product's title, price or description.", "product_id:string!,title:string,price:number"],
	],
	salesforce: [
		["create_lead", "Create a sales lead record.", "last_name:string!,company:string!,email:string"],
		["convert_lead", "Convert a lead into an account, contact and opportunity.", "lead_id:string!,opportunity_name:string"],
		["create_opportunity", "Create a sales opportunity.", "account_id:string!,name:string!,amount:number,close_date:string"],
		["update_opportunity", "Update an opportunity's stage or amount.", "opportunity_id:string!,stage:string,amount:number"],
		["create_account", "Create an account record.", "name:string!,industry:string"],
		["log_activity", "Log a call, meeting or email against a record.", "record_id:string!,type:string!,notes:string"],
		["run_report", "Run a saved Salesforce report.", "report_id:string!"],
		["create_task", "Create a follow-up task on a record.", "record_id:string!,subject:string!,due_date:string"],
		["search_records", "Search Salesforce records with SOSL.", "query:string!,object:string"],
		["update_contact", "Update a contact's details.", "contact_id:string!,email:string,phone:string"],
	],
	hubspot: [
		["create_contact", "Create a CRM contact.", "email:string!,first_name:string,last_name:string"],
		["update_contact", "Update a CRM contact's properties.", "contact_id:string!,properties:object!"],
		["create_deal", "Create a deal in the CRM pipeline.", "name:string!,amount:number,stage:string"],
		["move_deal_stage", "Move a deal to another pipeline stage.", "deal_id:string!,stage:string!"],
		["log_call", "Log a phone call against a contact.", "contact_id:string!,notes:string!,duration:number"],
		["send_marketing_email", "Send a marketing email to a saved contact list.", "email_id:string!,list_id:string!"],
		["create_list", "Create a static or dynamic contact list.", "name:string!,dynamic:boolean"],
		["enroll_workflow", "Enrol a contact into an automation workflow.", "contact_id:string!,workflow_id:string!"],
		["search_contacts", "Search CRM contacts by property.", "query:string!,limit:number"],
		["create_note", "Attach a note to a CRM record.", "record_id:string!,body:string!"],
	],
	sendgrid: [
		["send_email", "Send a transactional email to one recipient.", "to:string!,subject:string!,body:string!"],
		["send_campaign", "Send a marketing campaign to every address on a saved list.", "campaign_id:string!,list_id:string!,send_at:string"],
		["create_template", "Create a reusable email template.", "name:string!,html:string!"],
		["add_contact", "Add an address to the marketing contacts.", "email:string!,first_name:string"],
		["create_list", "Create a marketing contact list.", "name:string!"],
		["get_stats", "Get open, click and delivery statistics.", "start_date:string!,end_date:string"],
		["validate_email", "Check whether an address is deliverable.", "email:string!"],
		["schedule_send", "Schedule an already-built campaign for later.", "campaign_id:string!,send_at:string!"],
		["suppress_address", "Add an address to the suppression list.", "email:string!,group:string"],
		["list_bounces", "List addresses that bounced.", "start_time:string,limit:number"],
	],
	twilio: [
		["send_sms", "Send an SMS text message to a phone number.", "to:string!,body:string!,from:string"],
		["send_whatsapp", "Send a WhatsApp message to a number.", "to:string!,body:string!"],
		["make_call", "Place an outbound phone call.", "to:string!,twiml_url:string!"],
		["buy_number", "Buy a phone number in an area code.", "area_code:string!,country:string"],
		["list_messages", "List sent and received messages.", "to:string,since:string"],
		["create_verification", "Start a phone verification and send the code.", "to:string!,channel:string!"],
		["check_verification", "Check a verification code the user typed in.", "to:string!,code:string!"],
		["send_mms", "Send a picture message to a phone number.", "to:string!,media_url:string!,body:string"],
		["list_calls", "List call records.", "to:string,since:string"],
		["forward_call", "Forward an in-progress call to another number.", "call_sid:string!,to:string!"],
	],
	pagerduty: [
		["trigger_incident", "Page whoever is currently on call and open an incident.", "service_id:string!,title:string!,urgency:string"],
		["acknowledge_incident", "Acknowledge an incident so it stops escalating.", "incident_id:string!"],
		["resolve_incident", "Resolve an incident.", "incident_id:string!,resolution:string"],
		["list_oncall", "List who is on call right now for each schedule.", "schedule_id:string,since:string"],
		["create_schedule", "Create an on-call rotation schedule.", "name:string!,users:array!,rotation:string"],
		["add_responder", "Pull an extra responder into an active incident.", "incident_id:string!,user_id:string!"],
		["snooze_incident", "Snooze an incident for a period.", "incident_id:string!,duration:number!"],
		["list_incidents", "List incidents by status or service.", "status:string,service_id:string"],
		["create_escalation_policy", "Create an escalation policy.", "name:string!,rules:array!"],
		["notify_team", "Send a notification to an entire team.", "team_id:string!,message:string!"],
	],
	datadog: [
		["submit_metric", "Submit a custom metric point.", "metric:string!,value:number!,tags:array"],
		["create_monitor", "Create a monitor that alerts on a metric threshold.", "name:string!,query:string!,threshold:number!"],
		["mute_monitor", "Mute a monitor so it stops alerting, optionally until a time.", "monitor_id:number!,until:string"],
		["list_monitors", "List monitors and their alert state.", "name:string,tags:array"],
		["create_dashboard", "Create a dashboard of graphs.", "title:string!,widgets:array!"],
		["query_metrics", "Query a time series of a metric.", "query:string!,from:string!,to:string!"],
		["create_slo", "Create a service level objective.", "name:string!,target:number!,timeframe:string!"],
		["list_events", "List events on the event stream.", "start:string!,end:string!"],
		["post_event", "Post an event to the event stream.", "title:string!,text:string!,tags:array"],
		["search_logs", "Search ingested logs.", "query:string!,from:string,to:string"],
	],
	sentry: [
		["list_issues", "List unresolved error issues in a project, most frequent first.", "project:string!,query:string,stats_period:string"],
		["resolve_issue", "Mark an error issue resolved.", "issue_id:string!"],
		["ignore_issue", "Ignore an error issue so it stops alerting.", "issue_id:string!,duration:number"],
		["assign_issue", "Assign an error issue to a developer.", "issue_id:string!,assignee:string!"],
		["list_events", "List individual error events for an issue, with stack traces.", "issue_id:string!,limit:number"],
		["create_release", "Register a release so errors can be attributed to it.", "version:string!,projects:array!"],
		["list_projects", "List Sentry projects in the organisation.", "org:string"],
		["search_issues", "Search error issues by message or tag.", "query:string!,project:string"],
		["update_issue", "Change an error issue's status or assignee.", "issue_id:string!,status:string"],
		["list_replays", "List session replays attached to a project.", "project:string!,limit:number"],
	],
	aws_s3: [
		["upload_object", "Upload a file into an S3 bucket.", "bucket:string!,key:string!,body:string!"],
		["download_object", "Download an object out of an S3 bucket.", "bucket:string!,key:string!"],
		["delete_object", "Delete an object from an S3 bucket.", "bucket:string!,key:string!"],
		["list_objects", "List objects under a prefix in a bucket.", "bucket:string!,prefix:string,max_keys:number"],
		["create_bucket", "Create an S3 bucket in a region.", "bucket:string!,region:string!"],
		["get_bucket_size", "Report how much storage a bucket is using, in bytes and object count.", "bucket:string!,prefix:string"],
		["set_bucket_policy", "Replace a bucket's access policy.", "bucket:string!,policy:object!"],
		["create_presigned_url", "Create a time-limited download URL for an object.", "bucket:string!,key:string!,expires_in:number"],
		["copy_object", "Copy an object between buckets or keys.", "source_bucket:string!,source_key:string!,dest_bucket:string!,dest_key:string!"],
		["enable_versioning", "Turn on object versioning for a bucket.", "bucket:string!"],
	],
	aws_ec2: [
		["start_instance", "Start a stopped EC2 instance.", "instance_id:string!"],
		["stop_instance", "Stop a running EC2 instance so it stops being billed for compute.", "instance_id:string!,force:boolean"],
		["terminate_instance", "Terminate an EC2 instance permanently.", "instance_id:string!"],
		["list_instances", "List EC2 instances and their state.", "state:string,tag:string"],
		["create_snapshot", "Snapshot an attached EBS volume.", "volume_id:string!,description:string"],
		["resize_instance", "Change an instance's type.", "instance_id:string!,instance_type:string!"],
		["create_security_group", "Create a security group with ingress rules.", "name:string!,vpc_id:string!,rules:array"],
		["attach_volume", "Attach an EBS volume to an instance.", "instance_id:string!,volume_id:string!,device:string!"],
		["describe_costs", "Report EC2 spend broken down by instance.", "start:string!,end:string!"],
		["reboot_instance", "Reboot an EC2 instance.", "instance_id:string!"],
	],
	postgres: [
		["run_query", "Run a read-only SQL query against the application database.", "sql:string!,params:array"],
		["explain_query", "Show the planner's execution plan for a query.", "sql:string!,analyze:boolean"],
		["list_tables", "List tables in a schema with row estimates.", "schema:string"],
		["describe_table", "Show a table's columns, types and indexes.", "table:string!"],
		["create_index", "Create an index on a table's columns.", "table:string!,columns:array!,unique:boolean"],
		["vacuum_table", "Vacuum and analyse a table to reclaim space.", "table:string!,full:boolean"],
		["list_slow_queries", "List the slowest queries recorded by pg_stat_statements.", "limit:number,min_ms:number"],
		["create_role", "Create a database role with privileges.", "name:string!,login:boolean,privileges:array"],
		["backup_database", "Take a logical backup of the database.", "database:string!,destination:string!"],
		["restore_database", "Restore a database from a backup file.", "database:string!,source:string!"],
	],
	snowflake: [
		["run_query", "Run a SQL query against the analytics warehouse, where product and revenue history lives.", "sql:string!,warehouse:string"],
		["create_warehouse", "Create a compute warehouse.", "name:string!,size:string!,auto_suspend:number"],
		["resume_warehouse", "Resume a suspended warehouse.", "name:string!"],
		["suspend_warehouse", "Suspend a warehouse so it stops consuming credits.", "name:string!"],
		["list_databases", "List databases and schemas in the account.", "pattern:string"],
		["grant_role", "Grant a role to a user.", "role:string!,user:string!"],
		["load_from_stage", "Copy staged files into a table.", "table:string!,stage:string!,file_format:string"],
		["create_task", "Create a scheduled warehouse task.", "name:string!,schedule:string!,sql:string!"],
		["list_query_history", "List recent queries with their runtime and credits.", "since:string,limit:number"],
		["estimate_cost", "Estimate the credit cost of a query before running it.", "sql:string!,warehouse:string"],
	],
};

function expandParams(spec: string): Record<string, unknown> {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];
	for (const field of spec.split(",")) {
		const [rawName = "", rawType = "string"] = field.split(":");
		const isRequired = rawType.endsWith("!");
		const type = isRequired ? rawType.slice(0, -1) : rawType;
		properties[rawName] = type === "array" ? { type: "array", items: { type: "string" } } : { type };
		if (isRequired) required.push(rawName);
	}
	return { type: "object", properties, required };
}

export const CATALOG: CatalogTool[] = Object.entries(SERVICES).flatMap(([service, entries]) =>
	entries.map(([op, description, params]) => ({
		service,
		name: `${service}_${op}`,
		description,
		parameters: expandParams(params),
	})),
);

export const CATALOG_BY_NAME = new Map(CATALOG.map((tool) => [tool.name, tool]));

/**
 * The tasks.
 *
 * Written the way a person actually asks — "wake up whoever is on call", not
 * "trigger a PagerDuty incident". That gap is the whole difficulty. A task set
 * phrased in tool vocabulary would make both BM25 and the model look far better
 * than they are, and would measure nothing.
 *
 * `expected` is one tool name. Choosing a single right answer is a judgement call,
 * and Step 4 of the README says where it is shaky.
 */
export interface Task {
	id: string;
	prompt: string;
	expected: string;
}

export const TASKS: Task[] = [
	{ id: "oncall", prompt: "The 3am deploy failed and nobody noticed. Wake up whoever is on call.", expected: "pagerduty_trigger_incident" },
	{ id: "refund", prompt: "A customer emailed asking for their money back on charge ch_4471.", expected: "stripe_create_refund" },
	{ id: "signups", prompt: "I need last quarter's signup numbers out of the analytics warehouse.", expected: "snowflake_run_query" },
	{ id: "mainpush", prompt: "Someone pushed straight to main again on the api repo. Stop that from being possible.", expected: "github_update_branch_protection" },
	{ id: "checkout", prompt: "The checkout page is throwing 500s. Show me what is actually breaking.", expected: "sentry_list_issues" },
	{ id: "staging", prompt: "Our staging box burns money overnight when nobody uses it. Shut it down.", expected: "aws_ec2_stop_instance" },
	{ id: "meetingnotes", prompt: "Write up the outcome of today's architecture call somewhere the team will find it.", expected: "notion_create_page" },
	{ id: "shipped", prompt: "Text the customer on +1555 that their order has shipped.", expected: "twilio_send_sms" },
	{ id: "designbug", prompt: "The bug the designer reported needs to be on the sprint board for the app team.", expected: "linear_create_issue" },
	{ id: "launch", prompt: "Marketing wants everyone on the beta list to get the launch announcement email.", expected: "sendgrid_send_campaign" },
	{ id: "noisy", prompt: "The p99 latency alert has been crying wolf all week. Make it stop until Monday.", expected: "datadog_mute_monitor" },
	{ id: "backups", prompt: "Find out how much storage our backups bucket is eating.", expected: "aws_s3_get_bucket_size" },
];
