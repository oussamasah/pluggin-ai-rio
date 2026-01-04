#!/bin/bash

set -e

echo "🚀 Deploying RIO to Kubernetes"

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found. Please install kubectl."
    exit 1
fi

# Check if cluster is accessible
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster"
    exit 1
fi

echo "✓ Kubernetes cluster accessible"

# Create namespace if it doesn't exist
kubectl create namespace rio --dry-run=client -o yaml | kubectl apply -f -

# Apply secrets (you should update these with real values)
kubectl apply -f kubernetes/mongodb-statefulset.yaml -n rio
echo "✓ MongoDB deployed"

sleep 10

kubectl apply -f kubernetes/deployment.yaml -n rio
echo "✓ RIO application deployed"

# Wait for deployment
kubectl rollout status deployment/rio-deployment -n rio

# Get service URL
SERVICE_IP=$(kubectl get svc rio-service -n rio -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Service accessible at: http://${SERVICE_IP}"
echo ""
echo "To check status: kubectl get pods -n rio"
echo "To view logs: kubectl logs -f deployment/rio-deployment -n rio"
echo ""
