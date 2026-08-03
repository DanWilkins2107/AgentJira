---
name: aj-stage-notes-awaiting-agent-breakdown
description: Stage notes for awaiting_agent_breakdown. Load before starting any awaiting_agent_breakdown node.
---

# awaiting_agent_spec — project stage instructions

Make sure to keep specs concise. Consider using bullet points, and not even natural language
"- Supabase backend" is better than "We should use a Supabase backend" for example. 
Please be really concise. I can review from the code any specifics, I don't need the double-layering of documentation. 
State any points to pay attention to - e.g. security, in a bit more detail, but even then not too much. 
Should generally be a quick check of what you're going to do, not a full on specification for every single little thing in depth - I can check the PR review for this. 

## Examples
**Instead of** something long like this:
```
Scope: `data.aws_iam_policy_document.ci_apply` in `terraform/iam/main.tf`. Nothing else in that file.

## Statements

Keep `state_access` + `Ec2Read` as-is. Add:

**Ec2Create** — resources `*`, no condition (creates cannot be scoped pre-existence):
`ec2:CreateVpc`, `CreateSubnet`, `CreateInternetGateway`, `CreateNatGateway`, `AllocateAddress`, `CreateRouteTable`, `CreateSecurityGroup`, `CreateLaunchTemplate`

**Ec2Manage** — resources `*`, condition `StringEquals aws:ResourceTag/Project = var.name_prefix`:
`ec2:DeleteVpc`, `ModifyVpcAttribute`, `DeleteSubnet`, `ModifySubnetAttribute`, `AttachInternetGateway`, `DetachInternetGateway`, `DeleteInternetGateway`, `DeleteNatGateway`, `ReleaseAddress`, `CreateRoute`, `DeleteRoute`, `ReplaceRoute`, `AssociateRouteTable`, `DisassociateRouteTable`, `DeleteRouteTable`, `AuthorizeSecurityGroupIngress`, `AuthorizeSecurityGroupEgress`, `RevokeSecurityGroupIngress`, `RevokeSecurityGroupEgress`, `ModifySecurityGroupRules`, `DeleteSecurityGroup`, `CreateLaunchTemplateVersion`, `ModifyLaunchTemplate`, `DeleteLaunchTemplate`, `DeleteLaunchTemplateVersions`

Tag condition works because root provider sets `default_tags` Project=loopcliharness (terraform/terraform.tf + locals.tf). Rename name_prefix there -> this breaks.

**IamRole** — resources `arn:aws:iam::${var.account_id}:role/${var.name_prefix}-*`:
`iam:CreateRole`, `DeleteRole`, `GetRole`, `TagRole`, `UntagRole`, `ListRoleTags`, `UpdateAssumeRolePolicy`, `ListAttachedRolePolicies`, `ListRolePolicies`, `ListInstanceProfilesForRole`

**IamRoleAttach** — same resources, condition `StringEquals iam:PolicyARN = arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore`:
`iam:AttachRolePolicy`, `DetachRolePolicy`

**IamInstanceProfile** — resources `arn:aws:iam::${var.account_id}:instance-profile/${var.name_prefix}-*`:
`iam:CreateInstanceProfile`, `DeleteInstanceProfile`, `GetInstanceProfile`, `AddRoleToInstanceProfile`, `RemoveRoleFromInstanceProfile`, `TagInstanceProfile`, `UntagInstanceProfile`, `ListInstanceProfileTags`

**IamPassRole** — resources `arn:aws:iam::${var.account_id}:role/${var.name_prefix}-*`, condition `StringEquals iam:PassedToService = ec2.amazonaws.com`:
`iam:PassRole`

**DenyCiSelfManage** — effect Deny, actions `iam:*`, resources `arn:aws:iam::${var.account_id}:role/${var.name_prefix}-ci-*`

## Security points

- PassRole bounded two ways: ARN prefix + PassedToService=ec2. Never `*`. Unbounded PassRole is the escalation path.
- `-*` role prefix would otherwise reach `loopcliharness-ci-plan` / `-ci-apply`; DenyCiSelfManage closes that. Prefix (not `-vm*`) so a second instance role later needs no extra admin apply.
- No `iam:PutRolePolicy`. Inline-policy write + PassRole = CI mints an admin role, hands it to EC2. Merged config only attaches the SSM managed policy, so the PolicyARN condition covers it.
- No `ssm:*`. "SSM bits" = attaching AmazonSSMManagedInstanceCore to the instance role; terraform makes no SSM API calls.
- ResourceTag scoping is blast-radius protection, not an auth boundary — `ec2:CreateTags` stays `*`, so CI can tag a foreign resource into scope. Tightening tagging is its own node if wanted.

## Cuts

Nothing on origin/main uses `aws_instance`, `aws_key_pair` or `ssh_public_key`. Delete both dead statements:
- `Ec2Keys` (Create/Import/DeleteKeyPair) — access is SSM-only.
- `Ec2Compute` (RunInstances, Terminate/Start/Stop/Reboot, ModifyInstanceAttribute) — root manages a launch template, not instances. Reject this spec if terraform should own an `aws_instance` and I keep it.

## Acceptance

- `terraform fmt -check -recursive` + `validate` pass (existing CI gate).
- Actions cover every origin/main resource: modules/network (vpc, igw, 2 subnets, eip, nat gw, 2 route tables + assocs), modules/vm (SG + 3 egress rules, iam role, SSM attach, instance profile, launch template).
- No `iam:` action on resource `*`.
- No `terraform apply` — terraform/iam is local state, admin-applied (a2d624bd, firm-blocked on this).

## Notes

- a0e2cedd edits `ci_apply_assume` in the same file (prod -> deploy). Different block, no textual conflict; whichever lands second rebases.
- Out of scope, likely wants a node: `ci_plan` has no `iam:Get*`/`List*`, so plan refresh fails once the vm role + instance profile are in root state.
```

**go for something like this:**

```
Add Ec2 Permissions:
- Ec2Create
- Ec2Manage

Attach IAM role by adding:
- IamRole
- IamRoleAttach
- IamPassRole
- DenyCiSelfManage

Delete (Nothing on main uses them)
- Ec2Keys
- Ec2Compute
```