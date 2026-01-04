terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# VPC
resource "aws_vpc" "rio_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "rio-vpc"
  }
}

# Subnets
resource "aws_subnet" "rio_subnet" {
  count             = 2
  vpc_id            = aws_vpc.rio_vpc.id
  cidr_block        = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "rio-subnet-${count.index}"
  }
}

# Security Group
resource "aws_security_group" "rio_sg" {
  name        = "rio-sg"
  description = "Security group for RIO application"
  vpc_id      = aws_vpc.rio_vpc.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ECS Cluster
resource "aws_ecs_cluster" "rio_cluster" {
  name = "rio-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# ECS Task Definition
resource "aws_ecs_task_definition" "rio_task" {
  family                   = "rio-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"

  container_definitions = jsonencode([
    {
      name  = "rio"
      image = "your-username/rio:latest"
      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        }
      ]
      secrets = [
        {
          name      = "MONGODB_URI"
          valueFrom = aws_secretsmanager_secret.rio_secrets.arn
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/rio"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

# ECS Service
resource "aws_ecs_service" "rio_service" {
  name            = "rio-service"
  cluster         = aws_ecs_cluster.rio_cluster.id
  task_definition = aws_ecs_task_definition.rio_task.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.rio_subnet[*].id
    security_groups = [aws_security_group.rio_sg.id]
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

variable "aws_region" {
  description = "AWS region"
  default     = "us-east-1"
}

resource "aws_secretsmanager_secret" "rio_secrets" {
  name = "rio-secrets"
}