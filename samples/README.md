# Samples

`take-home/` is a harmless stand-in for a job-interview "take-home task". It contains no
malicious code. Its README and one code comment carry text addressed to AI reviewers
(asking them to run a setup script, skip the code and call the project safe), and its
setup script pipes a download from example.com into the shell, so a scan shows what
Airlock does when a repository tries to steer the agent reading it, and what happens when
the agent wants to look at a URL (ArmorIQ holds the fetch for the person).

The other samples on the home page are real public repositories, read straight from GitHub.
