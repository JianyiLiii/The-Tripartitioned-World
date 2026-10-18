// Only interface literals pass through tr(); names, titles and agendas stay intact.
export function getLanguage() {
  try { return localStorage.getItem('ttw.language') === 'zh' ? 'zh' : 'en'; }
  catch { return 'en'; }
}
export function setLanguage(language) {
  localStorage.setItem('ttw.language', language === 'zh' ? 'zh' : 'en');
}
export const dateLocale = () => getLanguage() === 'zh' ? 'zh-CN' : 'en-GB';
export function tr(text, variables) {
  const translated = getLanguage() === 'zh' ? (ZH[text] ?? text) : text;
  return variables ? translated.replace(/\{(\w+)\}/g, (match, key) => key in variables ? String(variables[key]) : match) : translated;
}
export const ZH = Object.fromEntries(`
Projects and meetings|项目和会议
Availability is saved by date. Choose a week, then select a meeting time.|空闲时间按日期保存，选择一周后选择会议时间。
Enter hours for the dates below. Other weeks stay unchanged.|填写下方具体日期的时段，其他周不会改变。
Clear availability for the displayed week? Other weeks will be kept. Save to apply.|清除当前显示周的空闲时间？其他周将保留，保存后生效。
Availability changed on another device. Refresh the page before editing again.|空闲时间已在其他设备修改，请刷新页面后重新编辑。
Choose valid calendar weeks and time ranges.|请选择有效的周和时间段。
Sign in|登录
Your name|用户名
Enter your name|输入用户名
Continue|继续
Enter a valid name.|请输入有效名称。
Too many attempts. Try again in {min} min.|尝试次数过多，请在 {min} 分钟后重试。
Service unavailable. Check the local server.|服务不可用，请检查本地服务器。
Cannot connect. Check that the local server is running.|无法连接，请确认本地服务器正在运行。
No account or password required. Use the same name to return.|无需注册或密码，下次使用相同用户名登录。
Sign out|退出登录
My time zone|我的时区
Good morning|早上好
Good afternoon|下午好
Good evening|晚上好
{n} upcoming|{n} 个即将开始
{n} awaiting a time|{n} 个待定时间
No upcoming meetings.|暂无即将开始的会议。
Create a meeting and invite members.|创建会议并邀请成员。
Meetings|会议
Create meeting|创建会议
All|全部
Upcoming|即将开始
Unscheduled|未安排
Past|已结束
No meetings yet|暂无会议
Create a meeting to collect availability.|创建会议，收集成员的空闲时间。
No meetings to show.|暂无可显示的会议。
Your device uses {detected}. Your saved time zone is {saved}.|设备时区为 {detected}，已保存的时区为 {saved}。
Use {city}|使用 {city}
Keep current setting|保留当前设置
{n}/{total} responded|{n}/{total} 人已回复
Your local time|你的当地时间
Weekly|每周
One-time|单次
In {n} min|{n} 分钟后
In {n} hr|{n} 小时后
Tomorrow|明天
In {n} days|{n} 天后
In progress|进行中
Ended|已结束
Time not set|时间未定
Organized by {name}|组织者：{name}
Scheduled|已安排
Edit meeting|编辑会议
Meeting name|会议名称
e.g. Weekly project sync|例如：每周项目同步
Agenda (optional)|议程（选填）
Topics and preparation|议题和准备事项
Duration|时长
Select participants|选择参与者
Only invited members can view this meeting. Add more members in the project.|只有受邀成员可以查看此会议，可在项目中添加成员。
Video call link (optional)|视频会议链接（选填）
Paste a Zoom, Meet, or other video call link|粘贴 Zoom、Meet 或其他视频会议链接
Enter a valid http or https link.|请输入有效的 http 或 https 链接。
Save changes|保存修改
Delete meeting|删除会议
Delete "{title}" and its availability responses? This cannot be undone.|删除“{title}”及其空闲时间回复？此操作无法撤销。
Meeting deleted|会议已删除
Meeting not found, or you have not been invited.|会议不存在，或你尚未受邀。
All meetings|全部会议
Organizer|组织者
Meeting created|会议已创建
Add availability|填写空闲时间
Confirm time|确认时间
Add your availability, then select a time from the responses.|填写空闲时间，再根据回复选择会议时间。
Availability saved. Review shared availability to choose a time.|空闲时间已保存，请查看共同空闲时间并选择会议时间。
Time confirmed. Join the meeting or add it to your calendar.|时间已确认，可加入会议或添加到日历。
Add my availability|填写我的空闲时间
View shared availability|查看共同空闲时间
Back to project|返回项目
Back to meetings|返回会议
Meeting time|会议时间
Choose a suggested time after members respond, or set one manually.|成员回复后选择推荐时间，也可手动设置。
Set time|设置时间
Change|修改
Clear scheduled time|清除已定时间
Clear the scheduled time? Availability responses will be kept.|清除已定时间？已填写的空闲时间将保留。
Scheduled time cleared|已定时间已清除
Add to calendar|添加到日历
Your local time · {city}|你的当地时间 · {city}
Participants’ local times|参与者的当地时间
Current local times|当前当地时间
Meeting link|会议链接
Join meeting|加入会议
Copy|复制
Link copied|链接已复制
No video call link added.|尚未添加视频会议链接。
Add link|添加链接
Edit|编辑
Remove link|移除链接
Video call link|视频会议链接
Participants|参与者
Invite members|邀请成员
Invite participants|邀请参与者
Invited members can view the meeting and add availability.|受邀成员可以查看会议并填写空闲时间。
Responded|已回复
Awaiting response|等待回复
Scheduling|安排时间
Availability|空闲时间
Enter availability in your local time. Shared times are calculated automatically.|按当地时间填写空闲时间，系统会自动计算共同空闲时间。
Select time|选择时间
Confirm meeting time|确认会议时间
One-time meeting|单次会议
Repeat weekly|每周重复
Meeting time confirmed|会议时间已确认
Date|日期
Start time|开始时间
{city} time|{city} 时间
My availability|我的空闲时间
Enter your local times. Each member sees times in their own time zone.|按当地时间填写，每位成员会看到自己时区的时间。
This availability uses {city}. Your current time zone is {current}.|此空闲时间使用 {city} 时区，你当前的时区为 {current}。
Start|开始
End|结束
Add time slot|添加时段
Remove|移除
More actions|更多操作
Copy to weekdays|复制到工作日
Copy to every day|复制到每天
Clear day|清除此日
Clear all|清空全部
Clear all availability for this meeting? Save to apply the change.|清除此会议的所有空闲时间？保存后生效。
Save availability|保存空闲时间
Saving…|保存中…
Saved|已保存
Unsaved changes|有未保存的修改
Saved {ago}|已于 {ago} 保存
Not saved yet|尚未保存
Could not save: {msg}|保存失败：{msg}
Leave without saving your changes?|离开并放弃未保存的修改？
Leave|离开
Shared availability|共同空闲时间
This week|本周
Previous week|上一周
Next week|下一周
Time zones and daylight saving time for {week}|{week} 的时区和夏令时
Display time zone|显示时区
Other time zone…|其他时区…
Available|空闲
/ {total} members|/ {total} 人
Me|我
Other members available|其他成员空闲
Drag on the grid to add or clear availability.|在表格中拖动，添加或清除空闲时间。
Tap to toggle · Hold and drag to select a range|点击切换 · 按住并拖动选择范围
{n}/{total} available|{n}/{total} 人空闲
Busy|忙碌
No response|未回复
Suggested times|推荐时间
Manage team|管理团队
Manage administrators|管理管理员
Add administrators|新增管理员
Only the owner can manage administrators.|只有所有者可以管理管理员。
The owner account cannot be demoted.|不能取消所有者的管理员权限。
Only the owner can appoint administrators. Each administrator manages a team of up to 50 members.|只有所有者可以任命管理员。每位管理员可管理最多 50 位成员的团队。
New administrators sign in with 123456 and can manage their own 50-member team. They cannot appoint administrators.|新管理员使用 123456 登录，可以管理自己的 50 人团队，但不能任命管理员。
Owner|所有者
Administrator|管理员
Member|成员
Change administrator access|更改管理员权限
Remove administrator access from {name}? Their team records are kept, but they cannot manage accounts until restored.|取消 {name} 的管理员权限？其团队记录保留，恢复权限前无法管理账户。
Make {name} an administrator? They will be able to add and manage up to 50 team members.|将 {name} 设为管理员？对方将可以新增并管理最多 50 位团队成员。
Remove admin access|取消管理员权限
Make administrator|设为管理员
Team capacity: {used}/50 members · {remaining} places available|团队容量：{used}/50 位成员 · 还可添加 {remaining} 位
Your team can have up to 50 members. Deleting a member frees a place.|你的团队最多可有 50 位成员。删除成员后会释放名额。
Your team has a capacity of 50 members. {remaining} place(s) remain. Delete a member to free a place.|你的团队最多可有 50 位成员，目前剩余 {remaining} 个名额。可先删除成员来释放名额。
Only accounts you added appear here. Deleted accounts cannot sign in. Meeting history is kept.|这里只显示你添加的账户。删除后将无法登录，会议历史保留。
You can only manage accounts you added.|你只能管理自己添加的账户。
You have not added any accounts yet.|你还没有添加任何账户。
Delete account|删除账户
Delete {name}? Sign-in access will stop immediately and one team place will be freed. Meeting history stays available. You can restore this account later if there is space.|删除 {name}？登录权限将立即撤销，并释放一个团队名额。会议历史会保留。有空余名额时可以恢复该账户。
Account deleted|账户已删除
Account restored|账户已恢复
Restore|恢复
Deleted|已删除
Disabled|已停用
Active|正常
Each administrator can add up to 50 users. New users cannot add accounts.|每位管理员最多可新增 50 位用户。新用户没有添加账户的权限。
Your user quota: {used}/50 used · {remaining} remaining|你的新增用户额度：已用 {used}/50 · 剩余 {remaining}
Each administrator can add 50 users. You can add {remaining} more. No users were added.|每位管理员最多可新增 50 位用户。你还可添加 {remaining} 位。本次未添加任何用户。
No future time fits this meeting in the saved availability.|已填写的空闲时间中，没有满足本次会议时长的未来时段。
At least {d} · {city} time|至少 {d} · {city} 时间
No availability submitted yet.|尚未有人提交空闲时间。
Shared availability will appear after other members respond.|其他成员回复后将显示共同空闲时间。
No shared time lasts {d}. These are the closest matches.|没有持续 {d} 的共同空闲时段，以下是最接近的结果。
No shared availability between two or more members.|暂无两位或更多成员的共同空闲时间。
Everyone shares up to {d}, less than the required {need}. These longer slots exclude some members.|所有人最多共同空闲 {d}，不足所需的 {need}。以下较长时段有部分成员无法参加。
Everyone|所有人
{n}/{total} members|{n}/{total} 人
Unavailable: {names}|无法参加：{names}
Show more|展开更多
Show less|收起
Select time zone|选择时区
Search countries or cities|搜索国家或城市
Use device time zone · {city}|使用设备时区 · {city}
{n} time zones|{n} 个时区
Other time zones|其他时区
No matching locations.|没有匹配的地点。
Time zone set to {city}|时区已设为 {city}
Asia|亚洲
Europe|欧洲
North America|北美洲
South America|南美洲
Oceania|大洋洲
Middle East|中东
Africa|非洲
Close|关闭
Cancel|取消
Back|返回
Confirm|确认
Loading…|加载中…
Retry|重试
Request failed: {msg}|请求失败：{msg}
Cannot connect to the server|无法连接服务器
Unknown error|未知错误
just now|刚刚
{n} min ago|{n} 分钟前
{n} hr ago|{n} 小时前
{n}d ago|{n} 天前
{m} min|{m} 分钟
{h} hr|{h} 小时
{h} hr {m} min|{h} 小时 {m} 分钟
Access approved by administrator|经管理员批准后访问
Access your projects and meetings.|查看你的项目和会议。
Add a name and description|添加名称和说明
Add members|添加成员
Add names or share an invite link|填写用户名或分享邀请链接
Add participants to the project first.|请先将参与者添加到项目。
Add people by name or share an invite link.|通过用户名添加成员，或分享邀请链接。
Add people to the project before inviting them to this meeting.|请先将成员添加到项目，再邀请他们参加此会议。
Add project members|添加项目成员
Add up to 100 members at a time.|每次最多添加 100 位项目成员。
Add users|添加用户
Add your availability to these meetings|为这些会议填写空闲时间
Adding…|添加中…
All project meetings|项目全部会议
All projects|全部项目
Ask a project member for a new invite link.|请向项目成员索取新的邀请链接。
Availability needed|待填写空闲时间
Availability preview|空闲时间预览
Availability saved|空闲时间已保存
Available.|空闲。
Awaiting availability|等待空闲时间回复
Back to overview|返回概览
Back to projects|返回项目列表
Blue|蓝色
Calendar|日历
Change password|修改密码
Change your default password before continuing.|请修改默认密码后继续。
Change your time zone|修改时区
Choose a date|选择日期
Choose a date and time in the future.|请选择未来的日期和时间。
Choose a date to view its week|选择日期以查看所在周
Choose a password different from your current password.|新密码不能与当前密码相同。
Choose a password other than 123456.|请选择 123456 以外的密码。
Choose a week, select a shared time, then confirm your meeting.|选择一周和共同空闲时间，再确认会议。
Choose between 1 and 366 days.|请选择 1 至 366 天。
Choose week by date|通过日期选择周
Clear|清除
Cloud workspace · Access by approval|云端工作区 · 审批后访问
Collect availability and confirm a time|收集空闲时间并确认会议时间
Compare availability|比较空闲时间
Compare availability across time zones.|比较不同时区的空闲时间。
Confirm new password|确认新密码
Confirmed|已确认
Continue to invitation|继续查看邀请
Copied|已复制
Copy link|复制链接
Could not load other future meetings.|无法加载其他未来会议。
Could not refresh future meetings. Showing the last saved list.|无法刷新未来会议，当前显示上次保存的列表。
Could not sync the current date with the server. Try again.|无法与服务器同步当前日期，请重试。
Counts show availability. Select a time to check the full meeting.|数字表示空闲人数，选择时间可检查整个会议时段。
Counts show available participants. A selection checks the full meeting duration.|数字表示空闲人数，选择时间后会检查整个会议时段。
Create a meeting in a project to collect availability.|在项目中创建会议，收集空闲时间。
Create a meeting or ask a member to add you to an existing one.|创建会议，或请成员将你加入现有会议。
Create a project|创建项目
Create a project or join one using an invite link.|创建项目，或通过邀请链接加入项目。
Create a project to organize members and meetings.|创建项目以管理成员和会议。
Create project|创建项目
Creating…|创建中…
Current password|当前密码
Current time needs to be synced. Reconnect to continue.|需要同步当前时间，请重新连接后继续。
Data stored on this computer|数据保存在此电脑
Date and time synced with the server|日期和时间已与服务器同步
Description (optional)|说明（选填）
Done|完成
Edit profile|编辑个人资料
Edit project|编辑项目
Enter a meeting name.|请输入会议名称。
Enter a name of 1–80 characters without control characters.|请输入 1–80 个字符的名称，不含控制字符。
Enter a new password containing exactly six digits.|请输入六位数字的新密码。
Enter a password containing exactly six digits.|请输入六位数字密码。
Enter a project name.|请输入项目名称。
Enter at least one member name.|请至少输入一个成员用户名。
Enter between 1 and 20 usernames.|请输入 1–20 个用户名。
Enter recurring hours in your local time. These apply to every week.|按当地时间填写固定时段，这些时段每周重复。
Enter your current six-digit password.|请输入当前的六位数字密码。
Enter your name.|请输入用户名。
Enter your six-digit password|输入六位数字密码
Enter your username.|请输入用户名。
Everyone available|所有人空闲
Everyone can attend|所有人均可参加
Everyone’s availability|所有人的空闲时间
Filter meetings|筛选会议
Filter project meetings|筛选项目会议
Free|空闲
From|起始日期
Future meetings|未来会议
Get started|开始
Green|绿色
Hours repeat each week. Choose a week, then select a meeting time.|空闲时段每周重复，选择一周后选择会议时间。
Invitation link copied.|邀请链接已复制。
Invitation unavailable|邀请不可用
Invite project members|邀请项目成员
Join project|加入项目
Join using an invite link or return to your projects.|通过邀请链接加入，或返回你的项目列表。
Jump to the week containing this date.|跳转到该日期所在周。
Limited shared time|共同空闲时间较少
Link selected. Press Ctrl+C or ⌘C to copy.|链接已选中，按 Ctrl+C 或 ⌘C 复制。
Loading future meetings…|正在加载未来会议…
Loading invitation…|正在加载邀请…
Loading project…|正在加载项目…
Loading workspace…|正在加载工作区…
Local mode · No password required|本地模式 · 无需密码
Local time zones|当地时区
Local workspace|本地工作区
Main navigation|主导航
Meeting created. Add your availability.|会议已创建，请填写空闲时间。
Meeting creation progress|会议创建进度
Meeting details|会议详情
Meeting duration|会议时长
Meeting scheduling|会议安排
Meeting starts|会议开始时间
Meeting times|会议时间
Meeting times for the selected week|所选周的会议时间
Meetings with a confirmed time|已确定时间的会议
Member|成员
Member login names|成员登录用户名
Members|成员
Members added to project|已添加项目成员
My hours|我的时段
My weekly availability|我每周的空闲时间
Names are case-insensitive. New users sign in with 123456 and can change it later. New users cannot add other users.|用户名不区分大小写。新用户使用 123456 登录，可自行修改密码，无需强制修改。新用户不能添加其他用户。
Names cannot contain tabs or other control characters.|用户名不能包含制表符或其他控制字符。
Names must be 80 characters or fewer.|用户名不能超过 80 个字符。
New password|新密码
New project|新建项目
Next: invite members|下一步：邀请成员
No availability requests|暂无待填写的空闲时间
No confirmed future meetings yet. Select a time in Weekly availability to schedule this meeting.|暂无已确认的未来会议，请在每周空闲时间中选择会议时间。
No description|暂无说明
No future start times|暂无未来的开始时间
No future time fits this meeting in the selected week.|所选周暂无适合此会议的未来时段。
No future time fits this meeting in the selected week. Add availability or choose another week.|所选周暂无适合此会议的未来时段，请添加空闲时间或选择其他周。
No matching meetings|没有匹配的会议
No matching meetings.|没有匹配的会议。
No matching projects.|没有匹配的项目。
No projects yet|暂无项目
No projects yet.|暂无项目。
No time selected|尚未选择时间
No upcoming meetings|暂无即将开始的会议
Number of days|天数
Once|单次
One response pending|一人尚未回复
One username per line|每行一个用户名
Only administrators can add users.|只有管理员可以添加用户。
Only the creator can change this setting.|只有创建者可以修改此设置。
Open project|打开项目
Or add members by name|或通过用户名添加成员
Orange|橘黄色
Overview|概览
Owner|创建者
Participant|参与者
Participant timelines|参与者时间表
Participants can add availability after the meeting is created.|会议创建后，参与者可以填写空闲时间。
Password|密码
Password updated|密码已更新
Pending|待回复
Planning session|规划会议
Press Enter to schedule.|按回车键安排会议。
Preview only. In your meeting, this opens the time confirmation dialog.|仅供预览。在实际会议中，此操作会打开时间确认窗口。
Private workspace|私有工作区
Private workspace · Access by approval|私有工作区 · 审批后访问
Project color|项目颜色
Project content|项目内容
Project created|项目已创建
Project invitation|项目邀请
Project invitation link|项目邀请链接
Project joined|已加入项目
Project list|项目列表
Project members can create meetings and choose participants for each meeting.|项目成员可以创建会议，并为每个会议选择参与者。
Project members updated. Select participants and save changes.|项目成员已更新，请选择参与者并保存修改。
Project name|项目名称
Project not found, or you have not joined it.|项目不存在，或你尚未加入。
Project review|项目回顾
Project scope and goals|项目范围与目标
Project unavailable|项目不可用
Project updated|项目已更新
Projects|项目
Projects you belong to|你参与的项目
Purple|紫色
Recipients must be able to reach this local server.|接收者需要能够访问此本地服务器。
Recipients open the link and enter a name to join.|接收者打开链接并输入用户名即可加入。
Replace your default password before opening the workspace.|请先修改默认密码，再进入工作区。
Retrying…|重试中…
Rose|玫红色
Sample confirmed meetings for these participants.|这些参与者的已确认会议示例。
Sample data only. Changes here do not affect your projects.|仅为示例数据，此处修改不会影响你的项目。
Sample data · 5 people|示例数据 · 5 人
Save and continue|保存并继续
Save availability to see suggested meeting times.|保存空闲时间后查看推荐会议时间。
Save name|保存用户名
Save password|保存密码
Scenario|情景
Schedule a meeting|安排会议
Scheduled meetings will appear here.|已安排的会议将显示在这里。
Search projects|搜索项目
Search projects…|搜索项目…
Select a project|选择项目
Select a project for this meeting.|请为此会议选择项目。
Select a start time to check every participant. Colored bars show available time.|选择开始时间以查看每位参与者的状态，彩色条表示空闲时间。
Select a time in the week|在周视图中选择时间
Select a valid project color.|请选择有效的项目颜色。
Select another filter to view meetings.|请选择其他筛选条件以查看会议。
Select valid participants.|请选择有效的参与者。
Selected time details|所选时间详情
Separate login names with commas or line breaks.|使用逗号或换行分隔登录用户名。
Set meeting time|设置会议时间
Set time manually|手动设置时间
Set your password|设置密码
Share invitation link|分享邀请链接
Show|显示
Sign in to view the invitation.|登录以查看邀请。
Sign-in is unavailable. Contact the administrator.|登录暂不可用，请联系管理员。
Signed in|已登录
Skip to content|跳转到正文
Some available|部分成员空闲
Start date|开始日期
Suggested times this week|本周推荐时间
Switch user|切换用户
Teal|青绿色
Team meeting · 30 min|团队会议 · 30 分钟
The Tripartitioned World|三等分的世界
The name or password is incorrect, or access has not been approved.|用户名或密码错误，或尚未获准访问。
The new passwords do not match.|两次输入的新密码不一致。
The workspace configuration could not be loaded. Try again.|无法加载工作区配置，请重试。
This invitation is unavailable. You can still sign in to your workspace.|此邀请不可用，你仍可登录工作区。
This invitation link is invalid. Request a new link.|邀请链接无效，请索取新的链接。
This local time does not exist because the clocks change. Choose another time.|夏令时切换导致此当地时间不存在，请选择其他时间。
This meeting|此会议
This person has not been approved for access. Contact the administrator.|此用户尚未获准访问，请联系管理员。
This start time cannot be selected.|此开始时间不可选。
This start time cannot be selected. Choose an available future time.|此开始时间不可选，请选择未来的可用时间。
This time is no longer available. Select another time.|此时间已不可用，请选择其他时间。
This username has changed. Use your current username.|此用户名已变更，请使用修改后的用户名。
This username is already in use. Choose another name.|此用户名已存在（不区分大小写），请使用其他名字。
Time zone not set|尚未设置时区
Time zone updated|时区已更新
Today|今天
Today · Future start times only|今天 · 仅显示未来开始时间
Too many attempts. Try again later.|尝试次数过多，请稍后重试。
Try again|重试
Unable to load project|无法加载项目
Unable to load workspace|无法加载工作区
Unavailable|无法参加
Unavailable.|无法参加。
Upcoming meetings|即将开始的会议
Use arrow keys to explore availability.|使用方向键查看空闲时间。
Use arrow keys to explore. Click or press Enter or Space on an available future time to schedule a meeting.|使用方向键浏览，点击未来的可用时间或按回车键、空格键安排会议。
Use arrow keys to explore. Press Enter or Space to change your weekly availability.|使用方向键浏览，按回车键或空格键修改每周空闲时间。
Use each member’s current username.|请使用每位成员当前的用户名。
Use exactly six digits. The new password cannot be 123456.|请输入六位数字，新密码不能为 123456。
Use the HTTPS address provided by the administrator.|请使用管理员提供的 HTTPS 地址。
Use this time|使用此时间
Use your current username and six-digit password. You stay signed in on this device for 30 days.|使用当前用户名和六位数字密码登录，此设备会保持登录 30 天。
Use your current username to return to your profile.|使用当前用户名登录你的账户。
Use your new username the next time you sign in. Your password, projects and meetings stay the same.|下次登录请使用修改后的用户名，密码、项目和会议保持不变。
Username|用户名
Username updated|用户名已更新
Usernames|用户名
View meeting|查看会议
View week|查看周
Weekly availability|每周空闲时间
Weekly availability for five sample participants|五位示例参与者的每周空闲时间
Weekly availability view|每周空闲时间视图
Workspace|工作区
You|你
You are the only project member. Add members from the project after creating this meeting.|你是项目中唯一的成员，创建会议后可在项目中添加其他成员。
You can add participants and confirm the time later.|稍后可添加参与者并确认时间。
You have left this meeting|你已退出此会议
Your current password is incorrect.|当前密码错误。
Your projects|你的项目
e.g. Alex, Sam, Jordan|例如：Alex, Sam, Jordan
e.g. Website redesign|例如：网站改版
 · Includes your unsaved hours| · 包含你尚未保存的时段
AUTOMATIC CONVERSION|自动转换
3 participants|3 位参与者
Mon|周一
Tue|周二
Wed|周三
Thu|周四
Fri|周五
Sat|周六
Sun|周日
MON|周一
TUE|周二
WED|周三
THU|周四
FRI|周五
Monday|星期一
Tuesday|星期二
Wednesday|星期三
Thursday|星期四
Friday|星期五
Saturday|星期六
Sunday|星期日
January|1月
February|2月
March|3月
April|4月
May|5月
June|6月
July|7月
August|8月
September|9月
October|10月
November|11月
December|12月
The user limit is {limit}. Only {remaining} account(s) can still be added. No users were added.|用户上限为 {limit} 人，目前还可添加 {remaining} 人。本次未添加任何用户。
Server storage is full. No users were added. Ask an administrator to free space or upgrade hosting.|服务器存储空间已满，本次未添加用户。请联系管理员清理空间或升级主机。
The server is temporarily unavailable. Please try again.|服务器暂不可用，请稍后重试。
{v0} user(s) added. Initial password: 123456|已添加 {v0} 位用户，初始密码：123456
Signed in as {v0}.|当前登录：{v0}。
You are invited to {v0}. Sign in to view the invitation.|你已受邀加入 {v0}，请登录查看邀请。
You have been invited to {v0}.|你已受邀加入 {v0}。
Created by {v0}|创建者：{v0}
{v0} visible meeting{v1}|{v0} 个可见会议
Joining as {v0} · {v1} member{v2}|以 {v0} 加入 · {v1} 位成员
{v0}/{v1} available · {v2}|{v0}/{v1} 人空闲 · {v2}
Choose week: {v0}|选择周：{v0}
{v0} · Time not set|{v0} · 时间未定
Confirmed times in {v0}. Weekly meetings show their next occurrence.|已确认的时间以 {v0} 时区显示。每周会议显示下一次时间。
Select a colored time that fits this {v0} meeting.|选择一个彩色时段，满足此会议所需的 {v0}。
{v0}/{v1} available for the full {v2}|{v0}/{v1} 人在整个 {v2} 内空闲
Unavailable or not responded: {v0}|无法参加或尚未回复：{v0}
{v0} {v1}, {v2}: {v3} of {v4} participants available{v5}{v6}|{v0} {v1}，{v2}：{v3}/{v4} 人空闲{v5}{v6}
{v0} of {v1} participants available. {v2}|{v0}/{v1} 人空闲。{v2}
{v0} days · {v1}|{v0} 天 · {v1}
Previous {v0} days|前 {v0} 天
Next {v0} days|后 {v0} 天
Daily best: people available for the full {v0}. Numbers show available / invited.|每日最佳时段：整个 {v0} 内均空闲的人数。数字表示空闲人数 / 受邀人数。
Best {v0} of {v1} available for {v2}|最佳时段：{v0}/{v1} 人在 {v2} 内空闲
Free for {v0}|空闲 {v0}
{v0}, {v1} of {v2} available for {v3}|{v0}，{v1}/{v2} 人在 {v3} 内空闲
{v0}/{v1} responses · {v2} meeting · {v3}|{v0}/{v1} 人已回复 · 会议时长 {v2} · {v3}
Times in {v0}|时区：{v0}
{v0} participant{v1} not responded. Full availability requires all {v2}.|{v0} 人尚未回复。全员空闲需要 {v2} 人均可参加。
For the full {v0}|整个 {v0} 内
30 minutes|30 分钟
60 minutes|60 分钟
90 minutes|90 分钟
Beijing / Shanghai|北京 / 上海
Beijing|北京
Shanghai|上海
Singapore|新加坡
Tokyo|东京
London|伦敦
Los Angeles|洛杉矶
Berlin|柏林
New York|纽约
Vancouver|温哥华
Toronto|多伦多
{v0} participant{v1}|{v0} 位参与者
{v0} member{v1}|{v0} 位成员
{v0} meeting{v1}|{v0} 个会议
{v0} days|{v0} 天
{v0} · {v1}/{v2} available|{v0} · {v1}/{v2} 人空闲
+{v0} day{v1}|+{v0} 天
{v0}/{v1} available|{v0}/{v1} 人空闲
`.trim().split('\n').map(line => {
  const separator = line.indexOf('|');
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
