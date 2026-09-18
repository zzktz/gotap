<script setup>
import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { CheckCircleOutlined, DatabaseOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons-vue'
import client from '@/api/client'

const data = ref(null)
const loading = ref(true)

function formatDate(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
}

function formatBytes(value) {
  const bytes = Number(value || 0)
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const amount = bytes / (1024 ** index)
  const precision = index === 0 ? 0 : amount >= 100 ? 0 : amount >= 10 ? 1 : 2
  return `${amount.toFixed(precision)} ${units[index]}`
}

async function load() {
  loading.value = true
  try {
    data.value = (await client.get('/v1/admin/overview')).data
  } catch (error) {
    if (!error.adminAuthExpired) message.error(error.response?.data?.detail || '总览加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-title">
      <div><h1>运行总览</h1><p>查看 GoTap 管理服务和用户账户状态。</p></div>
      <a-button :loading="loading" @click="load"><template #icon><ReloadOutlined /></template>刷新</a-button>
    </div>

    <a-alert v-if="data" type="success" show-icon class="service-alert">
      <template #message><span>管理 API 运行正常</span></template>
      <template #description>数据更新时间：{{ formatDate(data.generated_at) }}</template>
      <template #icon><CheckCircleOutlined /></template>
    </a-alert>

    <a-row :gutter="20" class="stat-row">
      <a-col :xs="24" :sm="12" :xl="8"><a-card class="stat-card stat-card-blue" :loading="loading"><div class="stat-card-top"><div class="stat-card-icon"><TeamOutlined /></div><span>用户总数</span></div><div class="stat-card-value">{{ data?.users?.total || 0 }}</div><div class="stat-note">当前注册用户</div></a-card></a-col>
      <a-col :xs="24" :sm="12" :xl="8"><a-card class="stat-card stat-card-cyan" :loading="loading"><div class="stat-card-top"><div class="stat-card-icon"><TeamOutlined /></div><span>启用用户</span></div><div class="stat-card-value">{{ data?.users?.enabled || 0 }}</div><div class="stat-note">可正常使用 GoTap</div></a-card></a-col>
      <a-col :xs="24" :sm="12" :xl="8"><a-card class="stat-card stat-card-orange" :loading="loading"><div class="stat-card-top"><div class="stat-card-icon"><TeamOutlined /></div><span>停用用户</span></div><div class="stat-card-value">{{ data?.users?.disabled || 0 }}</div><div class="stat-note">已被管理员停用</div></a-card></a-col>
    </a-row>

    <a-row :gutter="20">
      <a-col :xs="24" :xl="12"><a-card title="服务状态" class="panel-card" :loading="loading"><a-descriptions v-if="data" :column="1" bordered size="small"><a-descriptions-item label="管理 API"><a-tag color="success">运行正常</a-tag></a-descriptions-item><a-descriptions-item label="应用名称">GoTap</a-descriptions-item><a-descriptions-item label="最近更新">{{ formatDate(data.generated_at) }}</a-descriptions-item></a-descriptions></a-card></a-col>
      <a-col :xs="24" :xl="12"><a-card title="数据库" class="panel-card" :loading="loading"><template #extra><DatabaseOutlined /></template><a-descriptions v-if="data?.database" :column="1" bordered size="small"><a-descriptions-item label="数据库"><a-tag color="blue">{{ data.database.engine }}</a-tag> {{ formatBytes(data.database.size_bytes) }}</a-descriptions-item><a-descriptions-item label="数据表">{{ data.database.table_count }} 张</a-descriptions-item><a-descriptions-item label="最近备份" v-if="data.database.backup">{{ formatDate(data.database.backup.created_at) }} · {{ formatBytes(data.database.backup.size_bytes) }}</a-descriptions-item><a-descriptions-item label="最近备份" v-else><span class="warning-text">尚未生成</span></a-descriptions-item></a-descriptions></a-card></a-col>
    </a-row>
  </div>
</template>
